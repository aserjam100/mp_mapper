import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getTableColumns, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import {
  ac9Year,
  contentItemId,
  CURRICULA,
  curriculumId,
  curriculumObjectiveId,
  EDITIONS,
  editionId,
  locationId,
  mappingId,
  normText,
  productObjectiveId,
  type EditionCode,
  type MappingRole,
  type MappingStatus,
  type Rating,
} from '@mapper/shared';
import type { DB } from '../db/client.js';
import * as s from '../db/schema.js';
import type { ParsedCurriculumObjective, ParsedLocation } from './types.js';

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

export const sha256File = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Bulk upsert in chunks; `update` lists the columns overwritten on conflict. */
export async function upsert<T extends PgTable>(
  tx: Tx,
  table: T,
  rows: T['$inferInsert'][],
  target: PgColumn | PgColumn[],
  update: string[],
) {
  const cols = getTableColumns(table) as Record<string, PgColumn>;
  const set: Record<string, SQL> = {};
  for (const k of update) set[k] = sql.raw(`excluded."${cols[k].name}"`);
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const q = tx.insert(table).values(chunk as never);
    if (update.length) await q.onConflictDoUpdate({ target, set: set as never });
    else await q.onConflictDoNothing({ target });
  }
}

// ---------------------------------------------------------------- reference rows

export async function upsertReference(tx: Tx) {
  await upsert(
    tx,
    s.curricula,
    Object.values(CURRICULA).map((c) => ({
      id: curriculumId(c.code),
      code: c.code,
      name: c.name,
      country: c.country,
      version: c.version,
      publisherOwned: c.code !== CURRICULA.SG.code,
    })),
    s.curricula.id,
    ['name', 'country', 'version', 'publisherOwned'],
  );
  const home: Record<EditionCode, string | null> = { PINE: null, AU2: CURRICULA.AC9.code, PH_DPA: CURRICULA.PH.code };
  await upsert(
    tx,
    s.editions,
    Object.values(EDITIONS).map((e) => ({
      id: editionId(e.code),
      code: e.code,
      name: e.name,
      shortName: e.short,
      curriculumId: home[e.code] ? curriculumId(home[e.code]!) : null,
    })),
    s.editions.id,
    ['name', 'shortName', 'curriculumId'],
  );
}

// ---------------------------------------------------------------- curricula

export interface CurriculumDiff {
  curriculum: string;
  total: number;
  added: number;
  removed: number;
  changed: number;
  stubs: number;
}

export async function loadCurriculum(
  tx: Tx,
  curriculumCode: string,
  objectives: ParsedCurriculumObjective[],
  opts: { sourceFile?: string; stubs?: ParsedCurriculumObjective[] } = {},
): Promise<CurriculumDiff> {
  const cid = curriculumId(curriculumCode);
  const all = [...objectives, ...(opts.stubs ?? []).filter((st) => !objectives.some((o) => o.key === st.key))];
  const rows = all.map((o) => ({
    id: curriculumObjectiveId(curriculumCode, o.key),
    curriculumId: cid,
    code: o.code,
    gradeLabel: o.gradeLabel,
    gradeNum: o.gradeNum,
    track: o.track ?? null,
    strand: o.strand ?? null,
    subStrand: o.subStrand ?? null,
    topic: o.topic ?? null,
    objectiveNo: o.objectiveNo ?? null,
    text: o.text,
    textNorm: normText(o.text),
    sortKey: o.sortKey,
    status: 'active' as const,
    meta: o.meta ?? {},
  }));
  const existing = await tx
    .select({ id: s.curriculumObjectives.id, text: s.curriculumObjectives.text, status: s.curriculumObjectives.status })
    .from(s.curriculumObjectives)
    .where(sql`${s.curriculumObjectives.curriculumId} = ${cid}`);
  const before = new Map(existing.map((e) => [e.id, e]));
  const ids = new Set(rows.map((r) => r.id));
  let added = 0;
  let changed = 0;
  for (const r of rows) {
    const b = before.get(r.id);
    if (!b || b.status === 'removed') added++;
    else if (b.text !== r.text) changed++;
  }
  const removedIds = existing.filter((e) => e.status === 'active' && !ids.has(e.id)).map((e) => e.id);
  await upsert(tx, s.curriculumObjectives, rows, s.curriculumObjectives.id, [
    'code', 'gradeLabel', 'gradeNum', 'track', 'strand', 'subStrand', 'topic', 'objectiveNo', 'text', 'textNorm', 'sortKey', 'status', 'meta',
  ]);
  if (removedIds.length) await tx.update(s.curriculumObjectives).set({ status: 'removed' }).where(inArray(s.curriculumObjectives.id, removedIds));
  if (opts.sourceFile) await tx.update(s.curricula).set({ sourceFile: opts.sourceFile }).where(sql`${s.curricula.id} = ${cid}`);
  return { curriculum: curriculumCode, total: rows.length, added, removed: removedIds.length, changed, stubs: all.length - objectives.length };
}

/** AC9 objectives are code-only stubs until the ACARA text is supplied. */
export function ac9Stubs(codes: Iterable<string>): ParsedCurriculumObjective[] {
  return [...new Set(codes)].sort().map((code) => {
    const y = ac9Year(code);
    const strand = /AC9M(?:F|\d+)(N|A|M|SP|ST|P)\d/.exec(code)?.[1];
    const strandName: Record<string, string> = { N: 'Number', A: 'Algebra', M: 'Measurement', SP: 'Space', ST: 'Statistics', P: 'Probability' };
    return {
      key: code,
      code,
      gradeLabel: y === 0 ? 'Foundation' : `Year ${y}`,
      gradeNum: y,
      strand: strand ? strandName[strand] : null,
      text: `${code} (content description not yet imported)`,
      sortKey: `Y${String(y ?? 99).padStart(2, '0')}|${code}`,
      meta: { stub: true },
    };
  });
}

// ---------------------------------------------------------------- products

export interface ProductDiff {
  edition: string;
  locations: { total: number; added: number; removed: number; changed: number };
  objectives: { total: number; added: number; removed: number };
  contentItems: number;
  locationObjectiveLinks: number;
}

const LOC_FIELDS = [
  'editionId', 'contentItemId', 'parentLocationId', 'gradeNum', 'book', 'chapterNo', 'chapterTitle', 'unitNo', 'unitTitle',
  'lessonNo', 'lessonTitle', 'section', 'activityRef', 'externalId', 'activityTitle', 'type', 'optional', 'supplement',
  'reuseQuality', 'sortKey', 'sourceFile', 'sourceSheet', 'sourceRow', 'status', 'meta',
] as const;

/** Load one edition's parsed locations. Content and objectives owned by other editions must already be loaded. */
export async function loadProducts(tx: Tx, edition: EditionCode, locations: ParsedLocation[]): Promise<ProductDiff> {
  const eid = editionId(edition);

  // content items (own content only; PH activities may point at PINE content)
  const contents = new Map<string, typeof s.contentItems.$inferInsert>();
  for (const l of locations) {
    const id = contentItemId(l.content.edition, l.content.key);
    if (l.content.edition === edition && !contents.has(id)) {
      contents.set(id, { id, originEditionId: editionId(l.content.edition), kind: l.content.kind, title: l.content.title });
    }
  }
  await upsert(tx, s.contentItems, [...contents.values()], s.contentItems.id, ['kind', 'title']);

  // product objectives owned by this edition's locations (incl. PH rewordings attached to PINE content)
  const objectives = new Map<string, typeof s.productObjectives.$inferInsert>();
  for (const l of locations) {
    const cid = contentItemId(l.content.edition, l.content.key);
    const base = l.content.edition === edition ? 0 : 100;
    l.ownObjectives.forEach((text, i) => {
      const id = productObjectiveId(cid, text);
      if (!objectives.has(id)) objectives.set(id, { id, contentItemId: cid, ordinal: base + i, text, textNorm: normText(text), status: 'active' });
    });
  }

  // which existing objectives belong to this edition: those on its own content, plus rewordings it created
  const ownContentIds = [...contents.keys()];
  const existingObjs = ownContentIds.length
    ? await tx
        .select({ id: s.productObjectives.id, status: s.productObjectives.status })
        .from(s.productObjectives)
        // ordinal >= 100 = another edition's rewording attached to this content (owned by that edition)
        .where(sql`${inArray(s.productObjectives.contentItemId, ownContentIds)} AND ${s.productObjectives.ordinal} < 100`)
    : [];
  const prevReworded = await tx.execute<{ id: string; status: string }>(sql`
    SELECT DISTINCT po.id, po.status FROM product_objectives po
    JOIN location_objectives lo ON lo.product_objective_id = po.id AND lo.link = 'reworded_of'
    JOIN product_locations pl ON pl.id = lo.location_id AND pl.edition_id = ${eid}`);
  const beforeObjs = new Map<string, string>([...existingObjs.map((o) => [o.id, o.status] as const), ...[...prevReworded].map((o) => [o.id, o.status] as const)]);
  const objAdded = [...objectives.keys()].filter((id) => beforeObjs.get(id) !== 'active').length;
  const objRemoved = [...beforeObjs].filter(([id, st]) => st === 'active' && !objectives.has(id)).map(([id]) => id);
  await upsert(tx, s.productObjectives, [...objectives.values()], s.productObjectives.id, ['ordinal', 'text', 'textNorm', 'status']);
  if (objRemoved.length) await tx.update(s.productObjectives).set({ status: 'removed' }).where(inArray(s.productObjectives.id, objRemoved));

  // locations
  const keyToId = new Map(locations.map((l) => [l.key, locationId(edition, l.key)]));
  const rows = locations.map((l) => ({
    id: keyToId.get(l.key)!,
    editionId: eid,
    contentItemId: contentItemId(l.content.edition, l.content.key),
    parentLocationId: l.parentKey ? (keyToId.get(l.parentKey) ?? null) : null,
    gradeNum: l.gradeNum,
    book: l.book ?? null,
    chapterNo: l.chapterNo ?? null,
    chapterTitle: l.chapterTitle ?? null,
    unitNo: l.unitNo ?? null,
    unitTitle: l.unitTitle ?? null,
    lessonNo: l.lessonNo ?? null,
    lessonTitle: l.lessonTitle ?? null,
    section: l.section ?? null,
    activityRef: l.activityRef ?? null,
    externalId: l.externalId ?? null,
    activityTitle: l.activityTitle ?? null,
    type: l.type,
    optional: l.optional,
    supplement: l.supplement,
    reuseQuality: l.reuseQuality ?? null,
    sortKey: l.sortKey,
    sourceFile: l.sourceFile,
    sourceSheet: l.sourceSheet,
    sourceRow: l.sourceRow,
    status: 'active' as const,
    meta: { ...l.meta, key: l.key },
  }));
  const existingLocs = await tx.select().from(s.productLocations).where(sql`${s.productLocations.editionId} = ${eid}`);
  const beforeLocs = new Map(existingLocs.map((e) => [e.id, e]));
  let locAdded = 0;
  let locChanged = 0;
  const compare = ['chapterTitle', 'unitTitle', 'lessonTitle', 'activityTitle', 'type', 'optional', 'supplement', 'contentItemId', 'reuseQuality'] as const;
  for (const r of rows) {
    const b = beforeLocs.get(r.id);
    if (!b || b.status === 'removed') locAdded++;
    else if (compare.some((k) => (b as Record<string, unknown>)[k] !== (r as Record<string, unknown>)[k])) locChanged++;
  }
  const locRemoved = existingLocs.filter((e) => e.status === 'active' && !keyToId.has(String((e.meta as { key?: string }).key))).map((e) => e.id);
  await upsert(tx, s.productLocations, rows, s.productLocations.id, [...LOC_FIELDS]);
  if (locRemoved.length) await tx.update(s.productLocations).set({ status: 'removed' }).where(inArray(s.productLocations.id, locRemoved));

  // location -> objective links (rebuilt for this edition)
  const links: (typeof s.locationObjectives.$inferInsert)[] = [];
  const missing: string[] = [];
  const known = new Set<string>(objectives.keys());
  const foreign = new Set<string>();
  for (const l of locations) {
    const cid = contentItemId(l.content.edition, l.content.key);
    for (const d of l.delivers) {
      const oid = productObjectiveId(cid, d.text);
      if (!known.has(oid)) foreign.add(oid);
      links.push({ locationId: keyToId.get(l.key)!, productObjectiveId: oid, link: d.link });
    }
  }
  if (foreign.size) {
    const found = await tx.select({ id: s.productObjectives.id }).from(s.productObjectives).where(inArray(s.productObjectives.id, [...foreign]));
    const f = new Set(found.map((x) => x.id));
    for (const id of foreign) if (!f.has(id)) missing.push(id);
  }
  if (missing.length) throw new Error(`${edition}: ${missing.length} delivered objectives do not exist (load PINE before PH)`);
  await tx.execute(sql`DELETE FROM location_objectives lo USING product_locations pl WHERE pl.id = lo.location_id AND pl.edition_id = ${eid}`);
  const dedup = [...new Map(links.map((x) => [`${x.locationId}|${x.productObjectiveId}`, x])).values()];
  await upsert(tx, s.locationObjectives, dedup, [s.locationObjectives.locationId, s.locationObjectives.productObjectiveId], []);

  return {
    edition,
    locations: { total: rows.length, added: locAdded, removed: locRemoved.length, changed: locChanged },
    objectives: { total: objectives.size, added: objAdded, removed: objRemoved.length },
    contentItems: contents.size,
    locationObjectiveLinks: dedup.length,
  };
}

// ---------------------------------------------------------------- mappings

export interface MappingInput {
  curriculumObjectiveId: string;
  edition: EditionCode;
  locationId: string;
  productObjectiveId: string | null;
  rating: Rating;
  status: MappingStatus;
  role: MappingRole;
  scopeNote: string | null;
  relatedNote: string | null;
  note: string | null;
}

export interface MappingDiff {
  source: string;
  inSource: number;
  created: number;
  updated: number;
  unchanged: number;
  heldByReviewer: number;
  withdrawn: number;
}

const RANK: Record<Rating, number> = { covered: 3, check: 2, not_found: 1 };

/**
 * Import publisher or crosswalk mappings for one source. Mappings are append-only:
 * new link -> version 1; changed in source -> new version; unchanged -> nothing;
 * latest version made by a person -> left alone (counted); imported link gone from source -> new 'rejected' version.
 */
export async function loadMappings(tx: Tx, sourceKey: string, batchId: string, inputs: MappingInput[]): Promise<MappingDiff> {
  // merge duplicates of the same link (strongest rating wins, notes joined)
  const byId = new Map<string, MappingInput & { id: string }>();
  for (const m of inputs) {
    const id = mappingId(m.curriculumObjectiveId, editionId(m.edition), m.locationId, m.productObjectiveId);
    const prev = byId.get(id);
    if (!prev) byId.set(id, { ...m, id });
    else {
      if (RANK[m.rating] > RANK[prev.rating]) Object.assign(prev, { rating: m.rating, role: m.role });
      for (const k of ['scopeNote', 'relatedNote'] as const) {
        if (m[k] && prev[k] !== m[k] && !prev[k]?.includes(m[k]!)) prev[k] = prev[k] ? `${prev[k]} | ${m[k]}` : m[k];
      }
    }
  }
  const all = [...byId.values()];
  await upsert(
    tx,
    s.mappings,
    all.map((m) => ({ id: m.id, curriculumObjectiveId: m.curriculumObjectiveId, editionId: editionId(m.edition), productLocationId: m.locationId, productObjectiveId: m.productObjectiveId })),
    s.mappings.id,
    [],
  );

  const current = new Map<string, { version: number; rating: string; status: string; role: string; scope_note: string | null; related_note: string | null; source: string; note: string | null }>();
  const rowsCur = await tx.execute<{ mapping_id: string; version: number; rating: string; status: string; role: string; scope_note: string | null; related_note: string | null; source: string; note: string | null }>(sql`
    SELECT mapping_id, version, rating, status, role, scope_note, related_note, source, note FROM mapping_current
    WHERE mapping_id IN (SELECT mapping_id FROM mapping_versions WHERE note LIKE ${`[${sourceKey}]%`})
       OR mapping_id = ANY(string_to_array(${all.map((m) => m.id).join(',')}, ',')::uuid[])`);
  for (const r of rowsCur) current.set(r.mapping_id, r);

  const versions: (typeof s.mappingVersions.$inferInsert)[] = [];
  const diff: MappingDiff = { source: sourceKey, inSource: all.length, created: 0, updated: 0, unchanged: 0, heldByReviewer: 0, withdrawn: 0 };
  const tag = (n: string | null) => `[${sourceKey}]${n ? ' ' + n : ''}`;
  for (const m of all) {
    const cur = current.get(m.id);
    const base = { mappingId: m.id, rating: m.rating, role: m.role, status: m.status, scopeNote: m.scopeNote, relatedNote: m.relatedNote, source: 'imported' as const, importBatchId: batchId, actor: 'import' };
    if (!cur) {
      versions.push({ ...base, version: 1, note: tag(m.note) });
      diff.created++;
    } else if (cur.source !== 'imported') {
      diff.heldByReviewer++;
    } else if (cur.rating !== m.rating || cur.status !== m.status || cur.role !== m.role || (cur.scope_note ?? null) !== m.scopeNote || (cur.related_note ?? null) !== m.relatedNote) {
      versions.push({ ...base, version: cur.version + 1, note: tag('changed in source on re-import') });
      diff.updated++;
    } else diff.unchanged++;
  }
  // imported links from this source that are no longer in it
  for (const [id, cur] of current) {
    if (byId.has(id) || cur.source !== 'imported' || cur.status === 'rejected' || !cur.note?.startsWith(`[${sourceKey}]`)) continue;
    versions.push({ mappingId: id, version: cur.version + 1, rating: cur.rating as Rating, role: cur.role as MappingRole, status: 'rejected', scopeNote: cur.scope_note, relatedNote: cur.related_note, source: 'imported', importBatchId: batchId, actor: 'import', note: tag('no longer in source on re-import') });
    diff.withdrawn++;
  }
  for (let i = 0; i < versions.length; i += 1000) await tx.insert(s.mappingVersions).values(versions.slice(i, i + 1000));
  return diff;
}

export async function startBatch(tx: Tx, kind: string, file: string, path: string) {
  const [b] = await tx.insert(s.importBatches).values({ kind, file, sha256: sha256File(path) }).returning({ id: s.importBatches.id });
  return b.id;
}

export async function finishBatch(tx: Tx, id: string, report: Record<string, unknown>) {
  await tx.update(s.importBatches).set({ finishedAt: new Date(), report }).where(sql`${s.importBatches.id} = ${id}`);
}
