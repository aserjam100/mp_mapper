import type { EditionCode } from '@mapper/shared';
import type { CurriculumDiff, MappingDiff, ProductDiff } from './load.js';
import type { PhLinkStats } from './ph.js';
import type { ResolvedSgRow, SgMatchRow } from './sg.js';
import type { ParsedCurriculumObjective, ParseResult, SkippedRow } from './types.js';

interface Input {
  pine: ParseResult;
  au: ParseResult;
  ph: ParseResult & { linkStats: PhLinkStats[] };
  phCurriculum: { objectives: ParsedCurriculumObjective[]; notes: string[] };
  sgObjectives: ParsedCurriculumObjective[];
  sgMatches: { rows: SgMatchRow[]; skipped: SkippedRow[]; counts: Record<string, number> };
  sgResolved: ResolvedSgRow[];
  curricula: CurriculumDiff[];
  products: ProductDiff[];
  mappings: MappingDiff[];
  phStubs: ParsedCurriculumObjective[];
}

const tally = <T>(xs: T[], key: (x: T) => string) => {
  const m: Record<string, number> = {};
  for (const x of xs) m[key(x)] = (m[key(x)] ?? 0) + 1;
  return m;
};

export function buildReport(i: Input) {
  const perGrade: Record<string, Record<string, number>> = {};
  for (const [ed, p] of [['PINE', i.pine], ['AU2', i.au], ['PH_DPA', i.ph]] as [EditionCode, ParseResult][]) {
    for (const l of p.locations) {
      const k = `${ed}|${l.gradeNum}`;
      const g = (perGrade[k] ??= { locations: 0, teaching: 0, practice: 0, problem_solving: 0, review: 0, assessment: 0, objectives: 0, optional: 0, supplement: 0, codes: 0 });
      g.locations++;
      g[l.type]++;
      g.objectives += l.ownObjectives.length;
      if (l.optional) g.optional++;
      if (l.supplement) g.supplement++;
      g.codes += l.codes.length;
    }
  }
  const skipped = [
    ...i.pine.skipped.map((s) => ({ file: 'PINE', ...s })),
    ...i.au.skipped.map((s) => ({ file: 'AU', ...s })),
    ...i.ph.skipped.map((s) => ({ file: 'PH', ...s })),
    ...i.sgMatches.skipped.map((s) => ({ file: 'SG crosswalk', ...s })),
  ];
  const partialRows = i.sgResolved.filter((r) => r.link === 'bullet' && r.unmatchedLines.length);
  const partial = partialRows.length;
  return {
    generatedAt: new Date().toISOString(),
    perGrade,
    skippedByReason: tally(skipped, (s) => `${s.file} › ${s.sheet} › ${s.reason}`),
    skippedRows: skipped,
    phLink: i.ph.linkStats,
    phReuseQuality: tally(i.ph.locations.filter((l) => l.meta.pineLocationKey && !l.optional), (l) => String(l.reuseQuality ?? 'unknown colour')),
    phCrossGrade: i.ph.locations.filter((l) => l.meta.pineGrade && l.meta.pineGrade !== l.gradeNum).length,
    phCurriculumFlags: tally(i.phCurriculum.objectives, (o) => String(o.meta?.sheetFlag ?? 'none')),
    phStubs: i.phStubs.map((s) => s.code),
    sgCounts: i.sgMatches.counts,
    sgLink: tally(i.sgResolved, (r) => `${r.edition}|${r.link}`),
    sgPartialEvidence: partial,
    sgPartialSamples: partialRows.slice(0, 10).map((r) => `${r.edition} ${r.sourceSheet}!${r.sourceRow}: "${r.unmatchedLines.join(' / ').slice(0, 100)}"`),
    curricula: i.curricula,
    products: i.products,
    mappings: i.mappings,
    notes: [...i.pine.notes, ...i.au.notes, ...i.ph.notes, ...i.phCurriculum.notes],
  };
}

export type IngestReport = ReturnType<typeof buildReport>;

const table = (head: string[], rows: (string | number)[][]) =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

export function renderReport(r: IngestReport): string {
  const out: string[] = [`# Ingestion report`, ``, `Generated ${r.generatedAt} by \`pnpm ingest\`.`, ``];

  out.push(`## Product content by edition and grade`, ``);
  const keys = Object.keys(r.perGrade).sort();
  out.push(
    table(
      ['Edition', 'Grade', 'Locations', 'Teaching', 'Practice', 'Problem solving', 'Review', 'Objectives owned', 'Optional', 'Supplement', 'Approved code links'],
      keys.map((k) => {
        const [ed, g] = k.split('|');
        const v = r.perGrade[k];
        return [ed, g, v.locations, v.teaching, v.practice, v.problem_solving, v.review, v.objectives, v.optional, v.supplement, v.codes];
      }),
    ),
    '',
    'For PH, "objectives owned" counts only PH-native objectives and PH rewordings. Activities that reuse PINE bullets link to the PINE objective and do not add a new one.',
    '',
  );

  out.push(`## Load diff (this run vs database)`, ``);
  out.push(
    table(
      ['Edition', 'Locations', 'added', 'changed', 'removed', 'Objectives', 'added', 'removed', 'Content items', 'Location→objective links'],
      r.products.map((p) => [p.edition, p.locations.total, p.locations.added, p.locations.changed, p.locations.removed, p.objectives.total, p.objectives.added, p.objectives.removed, p.contentItems, p.locationObjectiveLinks]),
    ),
    '',
    table(['Curriculum', 'Objectives', 'added', 'changed', 'removed', 'of which stubs'], r.curricula.map((c) => [c.curriculum, c.total, c.added, c.changed, c.removed, c.stubs])),
    '',
    table(
      ['Mapping source', 'Links in source', 'created', 'new version', 'unchanged', 'held (reviewer edited)', 'withdrawn'],
      r.mappings.map((m) => [m.source, m.inSource, m.created, m.updated, m.unchanged, m.heldByReviewer, m.withdrawn]),
    ),
    '',
  );

  out.push(`## PH DPA → PINE content reuse`, ``);
  out.push(
    table(
      ['Sheet', 'Activities', 'Linked to PINE lesson', '… same bullet', '… reworded', 'PH-native (PH_ ref)', 'Blank ref', 'Unresolved ref'],
      r.phLink.map((s) => [s.sheet, s.activities, s.linkedToPine, s.sameObjective, s.rewordedObjective, s.phNative, s.blankRef, s.badRef]),
    ),
    '',
    `PH activities that use PINE content from a different grade: **${r.phCrossGrade}**.`,
    '',
    `Reuse quality (colour legend on the activity reference, grade sheets): ${Object.entries(r.phReuseQuality).map(([k, v]) => `${k} ${v}`).join(', ')}.`,
    '',
    `PH Curriculum sheet flags: ${Object.entries(r.phCurriculumFlags).map(([k, v]) => `${k} ${v}`).join(', ')}. PH codes used in DPA but missing from the sheet (created as stubs): ${r.phStubs.join(', ') || 'none'}.`,
    '',
  );

  out.push(`## SG crosswalk`, ``);
  out.push(table(['Count', 'Rows'], Object.entries(r.sgCounts).map(([k, v]) => [k, v])), '');
  const eds = ['PINE', 'AU2', 'PH_DPA'];
  out.push(
    table(
      ['Edition', 'Linked to bullet(s)', 'Linked to lesson only', 'Unlinked'],
      eds.map((e) => [e, r.sgLink[`${e}|bullet`] ?? 0, r.sgLink[`${e}|lesson`] ?? 0, r.sgLink[`${e}|unlinked`] ?? 0]),
    ),
    '',
    `Rows where some quoted lines matched no bullet (mapped to the bullets that did match): ${r.sgPartialEvidence}.`,
    '',
    ...r.sgPartialSamples.map((x) => `- ${x}`),
    '',
  );

  out.push(`## Rows skipped`, ``);
  out.push(table(['File › sheet › reason', 'Rows'], Object.entries(r.skippedByReason).map(([k, v]) => [k, v])), '');
  const detail = r.skippedRows.filter((s) => s.file !== 'SG crosswalk');
  if (detail.length) out.push(table(['File', 'Sheet', 'Row', 'Reason', 'Sample'], detail.map((s) => [s.file, s.sheet, s.row, s.reason, (s.sample ?? '').replace(/\|/g, '/')])), '');

  out.push(`## Notes`, ``, ...r.notes.map((n) => `- ${n}`), '');
  return out.join('\n');
}
