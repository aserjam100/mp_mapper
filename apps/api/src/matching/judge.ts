/**
 * LLM judge: for one curriculum objective, Claude picks the best candidate per edition (or none), rates it
 * Covered / Check / Not found and writes a one-line scope note. One call covers all editions of an objective.
 *
 * - Model from JUDGE_MODEL, effort from JUDGE_EFFORT (default low: this is a short classification task).
 * - Results are cached in llm_cache by a hash of model + effort + prompt, so re-runs cost nothing.
 * - Output is structured JSON (zod schema) and validated against the candidate keys.
 * - Server-side refusal fallbacks are on (`fallbacks: "default"`).
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { createHash } from 'node:crypto';
import { z } from 'zod/v4';
import { sqlClient as sql } from '../db/client.js';
import type { Candidate } from './retrieve.js';

export const judgeModel = () => process.env.JUDGE_MODEL ?? 'claude-opus-5-5';
const judgeEffort = () => (process.env.JUDGE_EFFORT ?? 'low') as 'low' | 'medium' | 'high';

/** $ per million tokens (input, output). Unknown models are priced as Opus 5.5 for the estimate. */
const PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-4-5': [1, 5],
  'claude-fable-5-1': [10, 50],
};
export const priceOf = (model: string) => PRICES[model] ?? PRICES['claude-opus-5-5']!;

const SYSTEM = `You check whether lessons in PR1ME mathematics textbooks teach a given school curriculum objective.

For each edition you get a short list of candidate lessons found by search. Decide per edition:
- best: the key of the one candidate that best teaches the objective, or null if none of them teaches it.
- rating:
  - "covered": the lesson teaches this skill at the scope the objective asks for (number range, method, representation, grade level are a reasonable fit).
  - "check": a lesson teaches the skill but something differs or is unclear: narrower or wider number range, different method, only part of the objective, a distant grade, or only practice/problem-solving content. A reviewer should look.
  - "not_found": no candidate teaches this skill. Candidates may be related but do not teach it. If one is closely related, you may still name it as best.
- note: one plain sentence (under 25 words) for a teacher-reviewer: what the lesson covers and what differs or is missing. No scores, no candidate keys.
- alternatives: up to 2 other candidate keys that also teach part of the objective, best first. Empty if none.

Prefer, in order: content that actually teaches the skill; teaching lessons over practice, problem-solving or review; non-optional and non-supplement content; the grade closest to the objective's grade.
"Scope notes" are computed by code from explicit numbers in the text and are reliable; take them into account.
"Approved for a similar objective" means a reviewer approved that lesson for a near-identical objective in another curriculum: strong evidence, but still check the scope.
Return one entry for every edition listed, using the edition codes exactly as given.`;

export const JudgeOutput = z.object({
  editions: z.array(
    z.object({
      edition: z.string(),
      best: z.string().nullable(),
      rating: z.enum(['covered', 'check', 'not_found']),
      note: z.string(),
      alternatives: z.array(z.string()),
    }),
  ),
});
export type JudgeOutput = z.infer<typeof JudgeOutput>;

export interface JudgeObjective {
  code: string | null;
  gradeLabel: string;
  strand: string | null;
  subStrand: string | null;
  text: string;
}

export function buildPrompt(obj: JudgeObjective, byEdition: Map<string, Candidate[]>): string {
  const lines: string[] = [];
  lines.push('Curriculum objective');
  lines.push(`  ${obj.code ? `${obj.code} · ` : ''}${obj.gradeLabel}${obj.strand ? ` · ${obj.strand}` : ''}${obj.subStrand ? ` / ${obj.subStrand}` : ''}`);
  lines.push(`  "${obj.text}"`);
  for (const [edition, cands] of byEdition) {
    lines.push('', `Edition ${edition}`);
    if (!cands.length) lines.push('  (no candidates found in the grade window)');
    for (const c of cands) {
      const flags = [c.type !== 'teaching' ? c.type.replace('_', ' ') : null, c.optional ? 'optional' : null, c.supplement ? 'supplement' : null]
        .filter(Boolean)
        .join(', ');
      lines.push(`  [${c.key}] ${c.label} (grade ${c.gradeNum}${flags ? `; ${flags}` : ''})`);
      const matched = new Set(c.bullets.map((b) => b.text));
      for (const b of c.lessonBullets.slice(0, 8)) lines.push(`    ${matched.has(b) ? '*' : '-'} ${b}`);
      if (c.lessonBullets.length > 8) lines.push(`    … ${c.lessonBullets.length - 8} more bullets`);
      for (const n of c.scopeNotes) lines.push(`    Scope note: ${n}`);
      for (const r of c.reuse ?? []) lines.push(`    Approved for a similar objective in ${r.curriculumCode}: ${r.objectiveCode ?? ''} "${r.objectiveText}"`);
    }
  }
  lines.push('', 'Bullets marked * matched the search; - are the lesson’s other objectives.');
  return lines.join('\n');
}

/** Rough token count (chars / 3.5) for the pre-run estimate; the real usage is recorded per call. */
const approxTokens = (s: string) => Math.ceil(s.length / 3.5);

export function estimateCost(prompts: string[], editions: number, model = judgeModel()) {
  const [pin, pout] = priceOf(model);
  const input = prompts.reduce((n, p) => n + approxTokens(SYSTEM) + approxTokens(p), 0);
  // ~120 visible tokens per edition plus some thinking at low effort
  const output = prompts.length * (editions * 120 + 400);
  const usd = (input * pin + output * pout) / 1e6;
  return { calls: prompts.length, inputTokens: input, outputTokens: output, usd: Number(usd.toFixed(2)), model };
}

export const cacheKey = (prompt: string, model = judgeModel(), effort = judgeEffort()) =>
  createHash('sha256').update(`${model}\n${effort}\n${SYSTEM}\n${prompt}`).digest('hex');

export async function cachedCount(prompts: string[]): Promise<number> {
  if (!prompts.length) return 0;
  const keys = prompts.map((p) => cacheKey(p));
  const [row] = await sql`SELECT count(*)::int AS n FROM llm_cache WHERE key IN ${sql(keys)}`;
  return row!.n;
}

let client: Anthropic | null = null;

export interface JudgeCall {
  output: JudgeOutput;
  cached: boolean;
  tokensIn: number;
  tokensOut: number;
  usd: number;
}

export async function judge(prompt: string): Promise<JudgeCall> {
  const model = judgeModel();
  const effort = judgeEffort();
  const key = cacheKey(prompt, model, effort);
  const [hit] = await sql`SELECT response FROM llm_cache WHERE key = ${key}`;
  if (hit) return { output: JudgeOutput.parse(hit.response), cached: true, tokensIn: 0, tokensOut: 0, usd: 0 };

  client ??= new Anthropic();
  const res = await client.beta.messages.parse({
    model,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort, format: betaZodOutputFormat(JudgeOutput) },
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });
  if (res.stop_reason === 'refusal') throw new Error(`Judge declined (${res.stop_details?.category ?? 'no category'})`);
  if (res.stop_reason === 'max_tokens') throw new Error('Judge output was cut off (max_tokens)');
  const output = res.parsed_output;
  if (!output) throw new Error('Judge returned no parsable JSON');
  const tokensIn = res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
  const tokensOut = res.usage.output_tokens;
  const [pin, pout] = priceOf(res.model);
  await sql`
    INSERT INTO llm_cache (key, response, tokens_in, tokens_out) VALUES (${key}, ${JSON.stringify(output)}::jsonb, ${tokensIn}, ${tokensOut})
    ON CONFLICT (key) DO NOTHING`;
  return { output, cached: false, tokensIn, tokensOut, usd: (tokensIn * pin + tokensOut * pout) / 1e6 };
}

/** Check the judge's answer against the candidate lists; anything unknown becomes an error for that edition. */
export function validate(output: JudgeOutput, byEdition: Map<string, Candidate[]>) {
  const result = new Map<string, { best: Candidate | null; rating: 'covered' | 'check' | 'not_found'; note: string; alternatives: Candidate[]; error?: string }>();
  for (const [edition, cands] of byEdition) {
    const e = output.editions.find((x) => x.edition === edition);
    if (!e) {
      result.set(edition, { best: null, rating: 'check', note: '', alternatives: [], error: 'Judge gave no answer for this edition' });
      continue;
    }
    const find = (k: string) => cands.find((c) => c.key === k) ?? null;
    const best = e.best ? find(e.best) : null;
    const error = e.best && !best ? `Judge named unknown candidate ${e.best}` : undefined;
    // a Covered/Check rating needs a lesson; without one it means nothing was found
    const rating = !best && e.rating !== 'not_found' ? 'not_found' : e.rating;
    result.set(edition, {
      best,
      rating,
      note: e.note.trim(),
      alternatives: e.alternatives.map(find).filter((c): c is Candidate => !!c && c !== best),
      error,
    });
  }
  return result;
}
