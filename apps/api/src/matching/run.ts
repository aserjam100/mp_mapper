/**
 * A matching run, in two stages so that the cost is known before anything is sent to the API:
 *
 *   retrieving  -> embed what's missing, retrieve candidates per objective x edition, rule checks,
 *                  store match_results, estimate the judge cost            -> ready
 *   judging     -> (only after the user confirms) call the judge per objective, store decisions,
 *                  and in `propose` mode write proposed mappings          -> done
 *
 * `finishWithoutJudge` turns a ready run into done using retrieval order only (no ratings).
 * In `accuracy` mode nothing is written to mappings, and the curriculum's own approved mappings are hidden.
 */
import { mappingId as mappingIdOf, type LocationType } from '@mapper/shared';
import { sqlClient as sql } from '../db/client.js';
import { getExternalConsent } from '../lib/settings.js';
import { computeAccuracy } from './accuracy.js';
import { embedConfig, embedLabel, ensureEmbeddings } from './embed.js';
import { buildPrompt, cachedCount, estimateCost, judge, judgeModel, validate, type JudgeObjective } from './judge.js';
import { DEFAULT_PARAMS, retrieveCandidates, type Candidate, type RetrieveParams } from './retrieve.js';

export interface RunOptions {
  curriculumId: string;
  mode: 'propose' | 'accuracy';
  editions: string[];
  gradeWindow?: number;
  types?: LocationType[];
  perEdition?: number;
  actor?: string;
}

type Log = (s: string) => void;

async function setProgress(runId: string, progress: Record<string, unknown>, status?: string) {
  if (status) await sql`UPDATE matching_runs SET progress = ${JSON.stringify(progress)}::jsonb, status = ${status} WHERE id = ${runId}`;
  else await sql`UPDATE matching_runs SET progress = ${JSON.stringify(progress)}::jsonb WHERE id = ${runId}`;
}

async function fail(runId: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Run ${runId} failed:`, err);
  await sql`UPDATE matching_runs SET status = 'failed', error = ${message}, finished_at = now() WHERE id = ${runId}`;
}

/** Simple promise pool. */
async function pool<T>(items: T[], size: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i]!, i);
      }
    }),
  );
}

export async function createRun(o: RunOptions): Promise<string> {
  const params: RetrieveParams = {
    ...DEFAULT_PARAMS,
    editions: o.editions,
    gradeWindow: o.gradeWindow ?? DEFAULT_PARAMS.gradeWindow,
    types: o.types ?? DEFAULT_PARAMS.types,
    perEdition: o.perEdition ?? DEFAULT_PARAMS.perEdition,
    hideCurriculumId: o.mode === 'accuracy' ? o.curriculumId : undefined,
  };
  const [run] = await sql`
    INSERT INTO matching_runs (curriculum_id, mode, params, embed_model, llm_model, status)
    VALUES (${o.curriculumId}, ${o.mode}, ${JSON.stringify({ ...params, actor: o.actor ?? 'user' })}::jsonb, ${embedLabel(embedConfig())}, ${judgeModel()}, 'retrieving')
    RETURNING id`;
  return run!.id;
}

/** Stage 1. */
export async function retrieveStage(runId: string, log: Log = () => {}): Promise<void> {
  try {
    const [run] = await sql`SELECT * FROM matching_runs WHERE id = ${runId}`;
    const params = run!.params as RetrieveParams;
    await setProgress(runId, { stage: 'embedding' });
    const embedded = await ensureEmbeddings(log);

    const objectives = await sql`
      SELECT id, curriculum_id, code, grade_label, grade_num, strand, sub_strand, text, embedding::text AS embedding
      FROM curriculum_objectives
      WHERE curriculum_id = ${run!.curriculum_id} AND status = 'active' AND coalesce(meta->>'stub', 'false') <> 'true'
      ORDER BY sort_key`;
    const editionRows = await sql`SELECT id, code FROM editions WHERE code IN ${sql(params.editions)}`;
    const editionIds = new Map(editionRows.map((e) => [e.code as string, e.id as string]));
    log(`Retrieving candidates for ${objectives.length} objectives × ${params.editions.length} editions…`);

    const prompts: string[] = [];
    let done = 0;
    await pool([...objectives], 4, async (o) => {
      const byEdition = await retrieveCandidates(
        { id: o.id, curriculumId: o.curriculum_id, text: o.text, gradeNum: o.grade_num, embedding: o.embedding },
        params,
      );
      prompts.push(buildPrompt(judgeObjective(o), byEdition));
      const rows = [...byEdition].map(([edition, cands]) => ({
        run_id: runId,
        curriculum_objective_id: o.id,
        edition_id: editionIds.get(edition)!,
        candidates: JSON.stringify(cands),
        chosen_location_id: cands[0]?.locationId ?? null,
        chosen_product_objective_id: cands[0]?.bullets[0]?.productObjectiveId ?? null,
      }));
      await sql`INSERT INTO match_results ${sql(rows as never)} ON CONFLICT (run_id, curriculum_objective_id, edition_id) DO NOTHING`;
      if (++done % 25 === 0 || done === objectives.length) {
        await setProgress(runId, { stage: 'retrieving', done, total: objectives.length });
        log(`  ${done} / ${objectives.length}`);
      }
    });

    const estimate = estimateCost(prompts, params.editions.length);
    const cached = await cachedCount(prompts);
    const remaining = estimate.calls ? estimate.usd * (1 - cached / estimate.calls) : 0;
    await sql`
      UPDATE matching_runs SET status = 'ready', est_cost = ${remaining.toFixed(2)},
        progress = ${JSON.stringify({ stage: 'ready', done, total: objectives.length })}::jsonb,
        report = ${JSON.stringify({ embedded, estimate: { ...estimate, cachedCalls: cached, usdRemaining: Number(remaining.toFixed(2)) } })}::jsonb
      WHERE id = ${runId}`;
    log(`Ready. Judge estimate: ${estimate.calls} calls (${cached} cached), about $${remaining.toFixed(2)} with ${estimate.model}.`);
  } catch (err) {
    await fail(runId, err);
    throw err;
  }
}

function judgeObjective(o: Record<string, unknown>): JudgeObjective {
  return {
    code: (o.code as string) ?? null,
    gradeLabel: o.grade_label as string,
    strand: (o.strand as string) ?? null,
    subStrand: (o.sub_strand as string) ?? null,
    text: o.text as string,
  };
}

async function loadResults(runId: string) {
  const rows = await sql`
    SELECT mr.id, mr.curriculum_objective_id, mr.edition_id, e.code AS edition, mr.candidates,
      co.code, co.grade_label, co.strand, co.sub_strand, co.text, co.sort_key
    FROM match_results mr JOIN editions e ON e.id = mr.edition_id JOIN curriculum_objectives co ON co.id = mr.curriculum_objective_id
    WHERE mr.run_id = ${runId} ORDER BY co.sort_key`;
  const byObjective = new Map<string, typeof rows>();
  for (const r of rows) byObjective.set(r.curriculum_objective_id, [...(byObjective.get(r.curriculum_objective_id) ?? []), r] as never);
  return byObjective;
}

/** Stage 2. Requires recorded consent; the caller has shown the estimate. */
export async function judgeStage(runId: string, log: Log = () => {}): Promise<void> {
  try {
    if (!(await getExternalConsent())) throw new Error('No consent recorded for sending product content to the Anthropic API.');
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set in .env');
    const [run] = await sql`UPDATE matching_runs SET status = 'judging' WHERE id = ${runId} AND status = 'ready' RETURNING *`;
    if (!run) throw new Error('Run is not ready for judging');
    const params = run.params as RetrieveParams;
    const byObjective = await loadResults(runId);
    const items = [...byObjective.values()];
    let done = 0;
    let usd = 0;
    let calls = 0;
    let cachedCalls = 0;
    let errors = 0;
    const concurrency = Number(process.env.JUDGE_CONCURRENCY ?? 4);
    log(`Judging ${items.length} objectives with ${judgeModel()}…`);

    await pool(items, concurrency, async (rows) => {
      const byEdition = new Map<string, Candidate[]>(params.editions.map((e) => [e, (rows.find((r) => r.edition === e)?.candidates ?? []) as Candidate[]]));
      const prompt = buildPrompt(judgeObjective(rows[0]!), byEdition);
      try {
        const call = await judge(prompt);
        usd += call.usd;
        if (call.cached) cachedCalls++;
        else calls++;
        const decided = validate(call.output, byEdition);
        for (const r of rows) {
          const d = decided.get(r.edition)!;
          await sql`
            UPDATE match_results SET judged = true, rating = ${d.rating}, note = ${d.note || null}, judge_error = ${d.error ?? null},
              chosen_location_id = ${d.best?.locationId ?? null},
              chosen_product_objective_id = ${d.best?.bullets[0]?.productObjectiveId ?? null},
              candidates = ${JSON.stringify(reorder(r.candidates as Candidate[], d.best, d.alternatives))}::jsonb
            WHERE id = ${r.id}`;
        }
      } catch (err) {
        errors++;
        const message = err instanceof Error ? err.message : String(err);
        await sql`UPDATE match_results SET judge_error = ${message} WHERE id IN ${sql(rows.map((r) => r.id))}`;
        if (errors >= 10 && errors > done / 2) throw new Error(`Too many judge errors; last: ${message}`);
      }
      if (++done % 10 === 0 || done === items.length) {
        await setProgress(runId, { stage: 'judging', done, total: items.length, usd: Number(usd.toFixed(4)), calls, cachedCalls, errors });
        log(`  ${done} / ${items.length}  $${usd.toFixed(2)}`);
      }
    });
    await sql`UPDATE matching_runs SET actual_cost = ${usd.toFixed(4)} WHERE id = ${runId}`;
    await finish(runId, { judged: true, calls, cachedCalls, errors, usd: Number(usd.toFixed(4)) });
  } catch (err) {
    await fail(runId, err);
    throw err;
  }
}

/** Judge's pick first, then its alternatives, then the rest in retrieval order. */
function reorder(cands: Candidate[], best: Candidate | null, alternatives: Candidate[]): (Candidate & { judge?: 'best' | 'alternative' })[] {
  const front = [best, ...alternatives].filter((c): c is Candidate => !!c);
  const keys = new Set(front.map((c) => c.key));
  return [
    ...front.map((c, i) => ({ ...c, judge: i === 0 && best ? ('best' as const) : ('alternative' as const) })),
    ...cands.filter((c) => !keys.has(c.key)),
  ];
}

export async function finishWithoutJudge(runId: string): Promise<void> {
  const [run] = await sql`UPDATE matching_runs SET status = 'finishing' WHERE id = ${runId} AND status = 'ready' RETURNING id`;
  if (!run) throw new Error('Run is not ready');
  try {
    await finish(runId, { judged: false });
  } catch (err) {
    await fail(runId, err);
    throw err;
  }
}

async function finish(runId: string, info: Record<string, unknown>) {
  const [run] = await sql`SELECT * FROM matching_runs WHERE id = ${runId}`;
  let written: Record<string, number> = {};
  if (run!.mode === 'propose') written = await writeProposals(runId, (run!.params as { actor?: string }).actor ?? 'user', info.judged === true);
  const accuracy = run!.mode === 'accuracy' ? await computeAccuracy(runId) : undefined;
  await sql`
    UPDATE matching_runs SET status = 'done', finished_at = now(),
      progress = progress || ${JSON.stringify({ stage: 'done' })}::jsonb,
      report = report || ${JSON.stringify({ ...info, written, ...(accuracy ? { accuracy } : {}) })}::jsonb
    WHERE id = ${runId}`;
}

/**
 * Write the run's decisions as proposed mappings (one per objective x edition, role `best`; a Not found
 * with a closest lesson is written as role `related`). Never overwrites a mapping that came from an import,
 * a reviewer or a reupload. Earlier matcher proposals for the same objective x edition that this run did not
 * choose are marked rejected ("superseded").
 */
async function writeProposals(runId: string, actor: string, judged: boolean) {
  const rows = await sql`SELECT * FROM match_results WHERE run_id = ${runId} AND chosen_location_id IS NOT NULL`;
  const counts = { written: 0, unchanged: 0, keptExisting: 0, superseded: 0 };
  for (const r of rows) {
    const rating = judged ? (r.rating ?? 'check') : 'check';
    const role = rating === 'not_found' ? 'related' : 'best';
    const note = judged ? r.note : 'Not checked by the AI judge: top search result only.';
    const scopeNotes = ((r.candidates as Candidate[]).find((c) => c.locationId === r.chosen_location_id)?.scopeNotes ?? []).join('; ');
    const mid = mappingIdOf(r.curriculum_objective_id, r.edition_id, r.chosen_location_id, r.chosen_product_objective_id);
    const [current] = await sql`SELECT * FROM mapping_current WHERE mapping_id = ${mid}`;
    if (current && current.source !== 'matcher') {
      counts.keptExisting++;
      await sql`UPDATE match_results SET mapping_id = ${mid} WHERE id = ${r.id}`;
      continue;
    }
    if (current && current.rating === rating && current.role === role && current.scope_note === (note ?? null) && current.status === 'proposed') {
      counts.unchanged++;
    } else {
      await sql`
        INSERT INTO mappings (id, curriculum_objective_id, edition_id, product_location_id, product_objective_id)
        VALUES (${mid}, ${r.curriculum_objective_id}, ${r.edition_id}, ${r.chosen_location_id}, ${r.chosen_product_objective_id})
        ON CONFLICT (id) DO NOTHING`;
      await sql`
        INSERT INTO mapping_versions (mapping_id, version, rating, role, status, scope_note, related_note, source, matching_run_id, actor, note)
        VALUES (${mid}, ${(current?.version ?? 0) + 1}, ${rating}, ${role}, 'proposed', ${note ?? null}, ${scopeNotes || null},
          'matcher', ${runId}, ${actor}, ${judged ? null : 'retrieval only'})`;
      counts.written++;
    }
    await sql`UPDATE match_results SET mapping_id = ${mid} WHERE id = ${r.id}`;

    const stale = await sql`
      SELECT * FROM mapping_current
      WHERE curriculum_objective_id = ${r.curriculum_objective_id} AND edition_id = ${r.edition_id}
        AND source = 'matcher' AND status = 'proposed' AND mapping_id <> ${mid}`;
    for (const s of stale) {
      await sql`
        INSERT INTO mapping_versions (mapping_id, version, rating, role, status, scope_note, related_note, source, matching_run_id, actor, note)
        VALUES (${s.mapping_id}, ${s.version + 1}, ${s.rating}, ${s.role}, 'rejected', ${s.scope_note}, ${s.related_note},
          'matcher', ${runId}, ${actor}, ${`superseded by run ${runId}`})`;
      counts.superseded++;
    }
  }
  return counts;
}

/** Runs left mid-stage by a server restart can't resume; mark them failed. */
export async function markInterruptedRuns() {
  await sql`
    UPDATE matching_runs SET status = 'failed', error = 'Interrupted (server restarted). Start a new run; judged answers are cached.', finished_at = now()
    WHERE status IN ('retrieving', 'judging', 'finishing')`;
}

