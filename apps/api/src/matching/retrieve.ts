/**
 * Candidate retrieval: for one curriculum objective, a separate ranked list of product locations per edition.
 *
 * 1. Vector search (pgvector cosine) and Postgres full-text search over product objectives (bullets),
 *    each ranked within its own edition, restricted to a grade window and to matchable location types.
 * 2. The two rankings are fused with reciprocal rank fusion and rolled up to locations (a location's
 *    score is its best bullet's).
 * 3. Reuse: approved mappings of near-identical objectives in *other* curricula are added as strong
 *    candidates, in the same edition or in any edition sharing the content item.
 * 4. Rule checks (number ranges, decimals) on each candidate's bullets.
 *
 * Scores are only used for ordering here and are never shown as confidence.
 */
import { MATCHABLE_TYPES, type LocationType } from '@mapper/shared';
import { sqlClient as sql } from '../db/client.js';
import { locationLabel, type LocationLike } from '../lib/labels.js';
import { compareLimits, extractLimits, mergeLimits } from './rules.js';
import { toVector } from './embed.js';

export interface RetrieveParams {
  editions: string[]; // edition codes
  gradeWindow: number; // +/- grades around the objective's grade
  types: LocationType[];
  perEdition: number; // candidates kept per edition
  reuseMinSimilarity: number; // cosine similarity for "same objective" in another curriculum
  /** Score multiplier lost per grade of distance from the objective's grade (closest grade first). */
  gradePenalty: number;
  /** Score multiplier for practice / problem-solving locations, so teaching lessons come first. */
  nonTeachingFactor: number;
  /** Accuracy mode: never use this curriculum's own mappings (they are the answer key). */
  hideCurriculumId?: string;
}

export const DEFAULT_PARAMS: Omit<RetrieveParams, 'editions'> = {
  gradeWindow: 1,
  types: MATCHABLE_TYPES,
  perEdition: 10,
  reuseMinSimilarity: 0.9,
  gradePenalty: 0.3,
  nonTeachingFactor: 0.85,
};

export interface CandidateBullet {
  productObjectiveId: string;
  text: string;
}

export interface Candidate {
  key: string; // short id shown to the judge, e.g. "PINE-3"
  locationId: string;
  contentItemId: string;
  label: string;
  gradeNum: number;
  type: string;
  optional: boolean;
  supplement: boolean;
  /** Matched bullets, best first. */
  bullets: CandidateBullet[];
  /** All bullets of the lesson, for the judge's context. */
  lessonBullets: string[];
  sources: ('vector' | 'text' | 'reuse')[];
  reuse?: { curriculumCode: string; objectiveCode: string | null; objectiveText: string; similarity: number }[];
  scopeNotes: string[];
  score: number;
}

export interface ObjectiveInput {
  id: string;
  curriculumId: string;
  text: string;
  gradeNum: number | null;
  embedding: string | null; // pgvector text form
}

const RRF_K = 60;
const POOL = 60; // bullets considered per edition from each ranking

export async function retrieveCandidates(obj: ObjectiveInput, p: RetrieveParams): Promise<Map<string, Candidate[]>> {
  const gmin = obj.gradeNum === null ? -100 : obj.gradeNum - p.gradeWindow;
  const gmax = obj.gradeNum === null ? 100 : obj.gradeNum + p.gradeWindow;
  const types = p.types as string[];

  // ranked bullets per edition, from each retriever
  const vectorRows = obj.embedding
    ? await sql`
      SELECT * FROM (
        SELECT e.code AS edition, pl.id AS location_id, pl.grade_num, pl.type::text AS type, po.id AS pobj_id,
          row_number() OVER (PARTITION BY e.code ORDER BY po.embedding <=> ${obj.embedding}::vector) AS rk
        FROM product_objectives po
        JOIN location_objectives lo ON lo.product_objective_id = po.id
        JOIN product_locations pl ON pl.id = lo.location_id
        JOIN editions e ON e.id = pl.edition_id
        WHERE po.status = 'active' AND pl.status = 'active' AND po.embedding IS NOT NULL
          AND e.code IN ${sql(p.editions)} AND pl.type::text IN ${sql(types)}
          AND pl.grade_num BETWEEN ${gmin} AND ${gmax}
      ) x WHERE rk <= ${POOL}`
    : [];
  const textRows = await sql`
    WITH q AS (SELECT replace(plainto_tsquery('english', ${obj.text})::text, '&', '|') AS s)
    SELECT * FROM (
      SELECT e.code AS edition, pl.id AS location_id, pl.grade_num, pl.type::text AS type, po.id AS pobj_id,
        row_number() OVER (PARTITION BY e.code ORDER BY ts_rank_cd(po.tsv, to_tsquery('english', q.s)) DESC) AS rk
      FROM q, product_objectives po
      JOIN location_objectives lo ON lo.product_objective_id = po.id
      JOIN product_locations pl ON pl.id = lo.location_id
      JOIN editions e ON e.id = pl.edition_id
      WHERE q.s <> '' AND po.tsv @@ to_tsquery('english', q.s) AND po.status = 'active' AND pl.status = 'active'
        AND e.code IN ${sql(p.editions)} AND pl.type::text IN ${sql(types)}
        AND pl.grade_num BETWEEN ${gmin} AND ${gmax}
    ) x WHERE rk <= ${POOL}`;

  // fuse per (location, bullet)
  type Pair = { edition: string; locationId: string; pobjId: string; score: number; sources: Set<'vector' | 'text'> };
  const gradeFactor = (g: number) => (obj.gradeNum === null ? 1 : Math.max(0.1, 1 - (p.gradePenalty ?? 0) * Math.abs(g - obj.gradeNum)));
  const pairs = new Map<string, Pair>();
  const add = (rows: readonly Record<string, unknown>[], source: 'vector' | 'text') => {
    for (const r of rows) {
      const k = `${r.location_id}|${r.pobj_id}`;
      const pair = pairs.get(k) ?? { edition: r.edition as string, locationId: r.location_id as string, pobjId: r.pobj_id as string, score: 0, sources: new Set() };
      const typeFactor = r.type === 'teaching' ? 1 : (p.nonTeachingFactor ?? 1);
      pair.score += (gradeFactor(Number(r.grade_num)) * typeFactor) / (RRF_K + Number(r.rk));
      pair.sources.add(source);
      pairs.set(k, pair);
    }
  };
  add(vectorRows, 'vector');
  add(textRows, 'text');

  // roll up to locations
  type Loc = { edition: string; locationId: string; score: number; bullets: { id: string; score: number }[]; sources: Set<Candidate['sources'][number]>; reuse?: Candidate['reuse'] };
  const locs = new Map<string, Loc>();
  for (const pair of pairs.values()) {
    const l = locs.get(pair.locationId) ?? { edition: pair.edition, locationId: pair.locationId, score: 0, bullets: [], sources: new Set() };
    l.score = Math.max(l.score, pair.score);
    l.bullets.push({ id: pair.pobjId, score: pair.score });
    pair.sources.forEach((s) => l.sources.add(s));
    locs.set(pair.locationId, l);
  }

  // reuse of approved work from other curricula
  if (obj.embedding) {
    const reuseRows = await sql`
      WITH near AS (
        SELECT co.id, co.code, co.text, cu.code AS curriculum_code, 1 - (co.embedding <=> ${obj.embedding}::vector) AS sim
        FROM curriculum_objectives co JOIN curricula cu ON cu.id = co.curriculum_id
        WHERE co.curriculum_id <> ${obj.curriculumId} AND co.embedding IS NOT NULL AND co.status = 'active'
          ${p.hideCurriculumId ? sql`AND co.curriculum_id <> ${p.hideCurriculumId}` : sql``}
        ORDER BY co.embedding <=> ${obj.embedding}::vector LIMIT 10
      )
      SELECT DISTINCT s.code, s.text, s.curriculum_code, s.sim, e.code AS edition, pl.id AS location_id, mc.product_objective_id
      FROM near s
      JOIN mapping_current mc ON mc.curriculum_objective_id = s.id AND mc.status = 'approved'
      JOIN product_locations src ON src.id = mc.product_location_id
      JOIN product_locations pl ON pl.content_item_id = src.content_item_id AND pl.status = 'active'
      JOIN editions e ON e.id = pl.edition_id
      WHERE s.sim >= ${p.reuseMinSimilarity} AND e.code IN ${sql(p.editions)} AND pl.type::text IN ${sql(types)}`;
    for (const r of reuseRows) {
      const l: Loc = locs.get(r.location_id) ?? { edition: r.edition, locationId: r.location_id, score: 0, bullets: [], sources: new Set() };
      // ahead of any retrieval-only candidate
      l.score = Math.max(l.score, 1 + Number(r.sim));
      l.sources.add('reuse');
      l.reuse = [...(l.reuse ?? []), { curriculumCode: r.curriculum_code, objectiveCode: r.code, objectiveText: r.text, similarity: Number(Number(r.sim).toFixed(3)) }]
        .filter((x, i, a) => a.findIndex((y) => y.curriculumCode === x.curriculumCode && y.objectiveCode === x.objectiveCode) === i);
      if (r.product_objective_id && !l.bullets.some((b) => b.id === r.product_objective_id)) l.bullets.unshift({ id: r.product_objective_id, score: 1 });
      locs.set(r.location_id, l);
    }
  }

  // keep the top N per edition, then load their details in one query
  const kept: Loc[] = [];
  for (const edition of p.editions) {
    kept.push(...[...locs.values()].filter((l) => l.edition === edition).sort((a, b) => b.score - a.score).slice(0, p.perEdition));
  }
  const out = new Map<string, Candidate[]>(p.editions.map((e) => [e, []]));
  if (!kept.length) return out;

  const details = await sql`
    SELECT pl.id AS location_id, e.code AS edition_code, pl.grade_num, pl.book, pl.chapter_no, pl.chapter_title, pl.unit_no, pl.unit_title,
      pl.lesson_no, pl.lesson_title, pl.section, pl.external_id, pl.activity_ref, pl.activity_title, pl.type, pl.optional, pl.supplement,
      pl.content_item_id,
      coalesce((SELECT json_agg(json_build_object('id', po.id, 'text', po.text) ORDER BY po.ordinal)
        FROM location_objectives lo JOIN product_objectives po ON po.id = lo.product_objective_id
        WHERE lo.location_id = pl.id AND po.status = 'active'), '[]') AS bullets
    FROM product_locations pl JOIN editions e ON e.id = pl.edition_id
    WHERE pl.id IN ${sql(kept.map((k) => k.locationId))}`;
  const byId = new Map(details.map((d) => [d.location_id as string, d]));
  const curriculumLimits = extractLimits(obj.text);

  for (const k of kept) {
    const d = byId.get(k.locationId);
    if (!d) continue;
    const all = d.bullets as { id: string; text: string }[];
    const textOf = new Map(all.map((b) => [b.id, b.text]));
    const matched = k.bullets
      .sort((a, b) => b.score - a.score)
      .filter((b) => textOf.has(b.id))
      .slice(0, 3)
      .map((b) => ({ productObjectiveId: b.id, text: textOf.get(b.id)! }));
    const list = out.get(k.edition)!;
    list.push({
      key: `${k.edition}-${list.length + 1}`,
      locationId: k.locationId,
      contentItemId: d.content_item_id,
      label: locationLabel(d as unknown as LocationLike),
      gradeNum: d.grade_num,
      type: d.type,
      optional: d.optional,
      supplement: d.supplement,
      bullets: matched,
      lessonBullets: all.map((b) => b.text),
      sources: [...k.sources],
      reuse: k.reuse,
      scopeNotes: compareLimits(curriculumLimits, mergeLimits(matched.map((b) => extractLimits(b.text)))),
      score: Number(k.score.toFixed(5)),
    });
  }
  return out;
}
