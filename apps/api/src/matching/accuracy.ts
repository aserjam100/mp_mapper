/**
 * Accuracy test: compare a run's results with the curriculum's approved mappings (the answer key, which the
 * run did not see). Per objective x edition:
 *
 * - best match found: the run's chosen lesson is one of the approved lessons
 * - found in top 3:    an approved lesson is among the run's first three candidates
 * - found at all:      an approved lesson is anywhere in the candidate list (retrieval ceiling)
 * - rating agreement:  approved mappings are all Covered, so the key expects Covered where an approved
 *                      mapping exists and Not found where none does
 *
 * A candidate counts as approved if it is the approved location or delivers the same content item.
 */
import { sqlClient as sql } from '../db/client.js';
import type { Candidate } from './retrieve.js';

interface Tally {
  objectives: number; // with an answer key
  bestFound: number;
  top3: number;
  anywhere: number;
  keyInWindow: number; // an approved lesson was searchable (grade window, matchable type)
  rated: number; // judged, with or without a key
  ratingAgree: number;
}

const empty = (): Tally => ({ objectives: 0, bestFound: 0, top3: 0, anywhere: 0, keyInWindow: 0, rated: 0, ratingAgree: 0 });

export interface AccuracyReport {
  editions: string[];
  judged: boolean;
  total: Tally & { noKey: number };
  confusion: Record<string, Record<string, number>>; // expected -> actual rating
  byGrade: Record<string, Tally>;
  byStrand: Record<string, Tally>;
  misses: { code: string | null; grade: string; text: string; edition: string; chosen: string | null; rating: string | null; note: string | null; approved: string[] }[];
}

export async function computeAccuracy(runId: string): Promise<AccuracyReport> {
  const [run] = await sql`SELECT * FROM matching_runs WHERE id = ${runId}`;
  const params = run!.params as { editions: string[]; gradeWindow: number; types: string[] };
  const results = await sql`
    SELECT mr.*, e.code AS edition, co.code, co.grade_label, co.grade_num, co.strand, co.text, co.sort_key
    FROM match_results mr JOIN editions e ON e.id = mr.edition_id JOIN curriculum_objectives co ON co.id = mr.curriculum_objective_id
    WHERE mr.run_id = ${runId} ORDER BY co.sort_key, e.code`;
  const key = await sql`
    SELECT mc.curriculum_objective_id, mc.edition_id, pl.id AS location_id, pl.content_item_id, pl.grade_num, pl.type::text AS type, pl.external_id, pl.lesson_title, pl.activity_title
    FROM mapping_current mc
    JOIN product_locations pl ON pl.id = mc.product_location_id
    JOIN curriculum_objectives co ON co.id = mc.curriculum_objective_id
    WHERE co.curriculum_id = ${run!.curriculum_id} AND mc.status = 'approved'`;
  const keyOf = new Map<string, typeof key>();
  for (const k of key) {
    const id = `${k.curriculum_objective_id}|${k.edition_id}`;
    keyOf.set(id, [...(keyOf.get(id) ?? []), k] as never);
  }

  const judged = results.some((r) => r.judged);
  const total = { ...empty(), noKey: 0 };
  const byGrade: Record<string, Tally> = {};
  const byStrand: Record<string, Tally> = {};
  const confusion: Record<string, Record<string, number>> = {};
  const misses: AccuracyReport['misses'] = [];

  for (const r of results) {
    const answers = keyOf.get(`${r.curriculum_objective_id}|${r.edition_id}`) ?? [];
    const locs = new Set(answers.map((a) => a.location_id));
    const contents = new Set(answers.map((a) => a.content_item_id));
    const hit = (c: { locationId: string; contentItemId: string }) => locs.has(c.locationId) || contents.has(c.contentItemId);
    const cands = r.candidates as Candidate[];
    const chosen = cands.find((c) => c.locationId === r.chosen_location_id) ?? null;
    const buckets = [total, (byGrade[r.grade_label] ??= empty()), (byStrand[r.strand ?? '(none)'] ??= empty())];

    if (answers.length) {
      const g = r.grade_num as number | null;
      const inWindow = answers.some(
        (a) => params.types.includes(a.type) && (g === null || Math.abs(a.grade_num - g) <= params.gradeWindow),
      );
      const best = !!chosen && hit(chosen);
      const top3 = cands.slice(0, 3).some(hit);
      const anywhere = cands.some(hit);
      for (const b of buckets) {
        b.objectives++;
        if (best) b.bestFound++;
        if (top3) b.top3++;
        if (anywhere) b.anywhere++;
        if (inWindow) b.keyInWindow++;
      }
      if (!best && misses.length < 60) {
        misses.push({
          code: r.code,
          grade: r.grade_label,
          text: r.text,
          edition: r.edition,
          chosen: chosen?.label ?? null,
          rating: r.rating,
          note: r.note,
          approved: answers.map((a) => [a.external_id, a.activity_title ?? a.lesson_title].filter(Boolean).join(' ')),
        });
      }
    } else {
      total.noKey++;
    }

    if (r.judged && r.rating) {
      const expected = answers.length ? 'covered' : 'not_found';
      // Check means "a reviewer should look": it agrees with neither, and is shown separately in the confusion table
      const agree = r.rating === expected;
      for (const b of buckets) {
        b.rated++;
        if (agree) b.ratingAgree++;
      }
      (confusion[expected] ??= {})[r.rating] = ((confusion[expected] ??= {})[r.rating] ?? 0) + 1;
    }
  }

  return { editions: params.editions, judged, total, confusion, byGrade, byStrand, misses };
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : '–');

export function renderAccuracy(curriculum: string, runId: string, a: AccuracyReport, meta: { embedModel: string; llmModel: string | null; gradeWindow: number; usd?: number }): string {
  const row = (name: string, t: Tally) =>
    `| ${name} | ${t.objectives} | ${pct(t.bestFound, t.objectives)} | ${pct(t.top3, t.objectives)} | ${pct(t.anywhere, t.objectives)} | ${pct(t.keyInWindow, t.objectives)} |${a.judged ? ` ${pct(t.ratingAgree, t.rated)} |` : ''}`;
  const head = `| | Objectives with approved mapping | Best match found | In top 3 | In candidate list | Approved lesson searchable |${a.judged ? ' Rating agreement |' : ''}\n|---|---|---|---|---|---|${a.judged ? '---|' : ''}`;
  const lines = [
    `# Accuracy test: ${curriculum}`,
    '',
    `Run \`${runId}\` · ${new Date().toISOString().slice(0, 10)} · editions ${a.editions.join(', ')} · embeddings ${meta.embedModel} · grade window ±${meta.gradeWindow}` +
      (a.judged ? ` · judge ${meta.llmModel}${meta.usd !== undefined ? ` ($${meta.usd.toFixed(2)})` : ''}` : ' · **no judge** (retrieval order only)'),
    '',
    'The curriculum’s approved mappings were hidden from the matcher and used as the answer key.',
    '',
    '- **Best match found**: the matcher’s chosen lesson is an approved one (same location or same shared content).',
    '- **In top 3 / in candidate list**: an approved lesson is among the first 3 / any of the candidates shown to the judge.',
    '- **Approved lesson searchable**: an approved lesson lies inside the grade window and the searched lesson types, which is the ceiling for retrieval.',
    a.judged
      ? '- **Rating agreement**: the key expects Covered where an approved mapping exists and Not found where none does. Check counts as disagreement.'
      : '- **Rating agreement** needs the AI judge and is not measured in this run.',
    '',
    '## Overall',
    '',
    head,
    row('All', a.total),
    '',
    `${a.total.noKey} objective × edition pairs have no approved mapping (expected Not found).`,
  ];
  if (a.judged) {
    const ratings = ['covered', 'check', 'not_found'];
    lines.push('', '### Ratings: expected (rows) vs matcher (columns)', '', '| | Covered | Check | Not found |', '|---|---|---|---|');
    for (const e of ['covered', 'not_found']) lines.push(`| ${e === 'covered' ? 'Covered' : 'Not found'} | ${ratings.map((x) => a.confusion[e]?.[x] ?? 0).join(' | ')} |`);
  }
  lines.push('', '## By grade', '', head, ...Object.entries(a.byGrade).map(([k, t]) => row(k, t)));
  lines.push('', '## By strand', '', head, ...Object.entries(a.byStrand).sort((x, y) => y[1].objectives - x[1].objectives).map(([k, t]) => row(k, t)));
  if (a.misses.length) {
    lines.push('', `## Misses (first ${a.misses.length})`, '', '| Code | Grade | Objective | Matcher chose | Rating | Approved |', '|---|---|---|---|---|---|');
    const esc = (s: string | null) => (s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    for (const m of a.misses) lines.push(`| ${esc(m.code)} | ${esc(m.grade)} | ${esc(m.text)} | ${esc(m.chosen) || '—'} | ${m.rating ?? '—'} | ${esc(m.approved.join('; '))} |`);
  }
  return lines.join('\n') + '\n';
}
