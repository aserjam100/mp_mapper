/**
 * `pnpm ingest` — parse the four source files and load them. Idempotent: stable IDs, upserts,
 * and mapping versions are only appended when something actually changed.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  contentItemId,
  CURRICULA,
  curriculumObjectiveId,
  locationId,
  phGrade,
  productObjectiveId,
  type EditionCode,
} from '@mapper/shared';
import { db, sqlClient } from '../db/client.js';
import { AU_FILE, parseAu } from './au.js';
import { loadGrids, loadWorkbook } from './excel.js';
import {
  ac9Stubs,
  finishBatch,
  loadCurriculum,
  loadMappings,
  loadProducts,
  startBatch,
  upsertReference,
  type MappingInput,
} from './load.js';
import { parsePh, PH_FILE } from './ph.js';
import { parsePhCurriculum } from './phCurriculum.js';
import { parsePine, PINE_FILE } from './pine.js';
import { buildReport, renderReport } from './report.js';
import { parseSgMatches, parseSgObjectives, resolveSgRows, SG_FILE, SG_SHEETS } from './sg.js';
import type { ParsedCurriculumObjective, ParsedLocation, ParseResult } from './types.js';

const root = resolve(import.meta.dirname, '../../../..');
const dir = resolve(root, process.env.SOURCE_DIR ?? 'data/source');
const path = (f: string) => resolve(dir, f);

const t0 = Date.now();
console.log(`Reading source files from ${dir}`);
const pine = parsePine(await loadWorkbook(path(PINE_FILE)));
const au = parseAu(await loadWorkbook(path(AU_FILE)));
const phWb = await loadWorkbook(path(PH_FILE));
const ph = parsePh(phWb, pine);
const phCurriculum = parsePhCurriculum(phWb);
const sgGrids = await loadGrids(path(SG_FILE), SG_SHEETS);
const sgObjectives = parseSgObjectives(sgGrids.get('SG objectives')!);
const sgMatches = parseSgMatches(sgGrids.get('Match detail')!);
const parsed: Record<EditionCode, ParseResult> = { PINE: pine, AU2: au, PH_DPA: ph };
const sgResolved = resolveSgRows(sgMatches.rows, parsed);
console.log(`Parsed in ${((Date.now() - t0) / 1000).toFixed(1)}s; loading…`);

function codeMappings(edition: EditionCode, curriculumCode: string, locs: ParsedLocation[]): MappingInput[] {
  const out: MappingInput[] = [];
  for (const l of locs) {
    for (const c of l.codes) {
      out.push({
        curriculumObjectiveId: curriculumObjectiveId(curriculumCode, c.code),
        edition,
        locationId: locationId(edition, l.key),
        productObjectiveId: c.objectiveText ? productObjectiveId(contentItemId(l.content.edition, l.content.key), c.objectiveText) : null,
        rating: 'covered',
        status: 'approved',
        role: 'alternative',
        scopeNote: null,
        relatedNote: null,
        note: `publisher mapping, ${l.sourceSheet} row ${c.sourceRow}`,
      });
    }
  }
  return out;
}

const result = await db.transaction(async (tx) => {
  await upsertReference(tx);
  const batches = {
    pine: await startBatch(tx, 'pine', PINE_FILE, path(PINE_FILE)),
    au: await startBatch(tx, 'au', AU_FILE, path(AU_FILE)),
    ph: await startBatch(tx, 'ph', PH_FILE, path(PH_FILE)),
    sg: await startBatch(tx, 'sg_crosswalk', SG_FILE, path(SG_FILE)),
  };

  // curricula
  const phKnown = new Set(phCurriculum.objectives.map((o) => o.code));
  const phStubs: ParsedCurriculumObjective[] = [];
  for (const l of ph.locations)
    for (const c of l.codes)
      if (!phKnown.has(c.code) && !phStubs.some((x) => x.key === c.code)) {
        const g = phGrade(c.code);
        phStubs.push({
          key: c.code, code: c.code, gradeLabel: `Grade ${g}`, gradeNum: g,
          text: String(l.meta.phCodeText ?? '').replace(/^[^:]*:\s*/, '') || `${c.code} (not in PH Curriculum sheet)`,
          sortKey: `G${g}|9999|${c.code}`, meta: { stub: true, reason: 'code used in PH DPA but not listed in PH Curriculum sheet' },
        });
      }
  const curricula = [
    await loadCurriculum(tx, CURRICULA.PH.code, phCurriculum.objectives, { sourceFile: `${PH_FILE} › PH Curriculum`, stubs: phStubs }),
    await loadCurriculum(tx, CURRICULA.AC9.code, [], { sourceFile: `codes from ${AU_FILE}`, stubs: ac9Stubs(au.locations.flatMap((l) => l.codes.map((c) => c.code))) }),
    await loadCurriculum(tx, CURRICULA.SG.code, sgObjectives, { sourceFile: `${SG_FILE} › SG objectives` }),
  ];

  // products (PINE first: PH links into PINE content)
  const products = [
    await loadProducts(tx, 'PINE', pine.locations),
    await loadProducts(tx, 'AU2', au.locations),
    await loadProducts(tx, 'PH_DPA', ph.locations),
  ];

  // mappings
  const sgInputs: MappingInput[] = [];
  for (const r of sgResolved) {
    if (!r.location) continue;
    const cid = contentItemId(r.location.content.edition, r.location.content.key);
    const related = r.rating === 'not_found';
    const base = {
      curriculumObjectiveId: curriculumObjectiveId(CURRICULA.SG.code, r.sgId),
      edition: r.edition,
      locationId: locationId(r.edition, r.location.key),
      rating: r.rating,
      status: 'proposed' as const,
      role: related ? ('related' as const) : ('alternative' as const),
      scopeNote: related ? null : r.scopeReason || null,
      relatedNote: related ? r.scopeReason || 'Related only' : null,
      note: `SG Match detail row ${r.row} (${r.recordId}, ${r.status})`,
    };
    if (r.link === 'lesson') sgInputs.push({ ...base, productObjectiveId: null });
    else for (const o of r.objectives) sgInputs.push({ ...base, productObjectiveId: productObjectiveId(cid, o) });
  }
  const mappings = [
    await loadMappings(tx, 'au-ac9', batches.au, codeMappings('AU2', CURRICULA.AC9.code, au.locations)),
    await loadMappings(tx, 'ph-deped', batches.ph, codeMappings('PH_DPA', CURRICULA.PH.code, ph.locations)),
    await loadMappings(tx, 'sg-crosswalk', batches.sg, sgInputs),
  ];

  const report = buildReport({ pine, au, ph, phCurriculum, sgObjectives, sgMatches, sgResolved, curricula, products, mappings, phStubs });
  for (const [k, id] of Object.entries(batches)) await finishBatch(tx, id, { ...report, batch: k });
  return report;
});

const md = renderReport(result);
mkdirSync(resolve(root, 'docs'), { recursive: true });
writeFileSync(resolve(root, 'docs/ingestion-report.md'), md);
console.log(md.split('\n## Notes')[0]);
console.log(`\nFull report: docs/ingestion-report.md (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
await sqlClient.end();
