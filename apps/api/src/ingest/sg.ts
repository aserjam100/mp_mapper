import { clean, normText, SG_STATUS_TO_RATING, textSimilarity, type EditionCode, type Rating } from '@mapper/shared';
import type { Grid } from './excel.js';
import type { ParsedCurriculumObjective, ParsedLocation, ParseResult, SkippedRow } from './types.js';

export const SG_FILE = 'Singapore_Product_Curriculum_Crosswalk.xlsx';
const HEADER_ROW = 5;

const EDITION_BY_LABEL: Record<string, EditionCode | null> = {
  PINE: 'PINE',
  'PR1ME Australia': 'AU2',
  'PR1ME PH DPA': 'PH_DPA',
  'PR1ME NZ': null, // out of scope: dropped
};

function headerMap(ws: Grid): Map<string, number> {
  const m = new Map<string, number>();
  for (let c = 1; c <= 80; c++) {
    const h = clean(ws.get(HEADER_ROW, c));
    if (h && !m.has(h)) m.set(h, c);
  }
  return m;
}

function reader(ws: Grid, hdr: Map<string, number>, r: number) {
  return (name: string, raw = false) => {
    const c = hdr.get(name);
    if (!c) throw new Error(`${ws.name}: column "${name}" not found in header row ${HEADER_ROW}`);
    const t = ws.get(r, c);
    return raw ? t : clean(t);
  };
}

export const SG_SHEETS = ['SG objectives', 'Match detail'];

export function parseSgObjectives(ws: Grid): ParsedCurriculumObjective[] {
  const hdr = headerMap(ws);
  const out: ParsedCurriculumObjective[] = [];
  for (let r = HEADER_ROW + 1; r <= ws.rowCount; r++) {
    const get = reader(ws, hdr, r);
    const id = get('SG ID');
    if (!id) continue;
    const grade = get('SG grade');
    out.push({
      key: id,
      code: id,
      gradeLabel: grade,
      gradeNum: Number(grade.replace(/\D/g, '')) || null,
      track: get('SG track') || null,
      strand: get('SG strand') || null,
      subStrand: get('SG sub-strand') || null,
      topic: get('SG topic') || null,
      objectiveNo: get('SG objective no.') || null,
      text: get('SG objective'),
      sortKey: `${get('SG track') === 'Foundation' ? '2' : '1'}|${grade}|${String(r).padStart(4, '0')}`,
      meta: { pdfPage: get('SG PDF page') || null, generatedId: true },
    });
  }
  return out;
}

export interface SgMatchRow {
  row: number;
  sgId: string;
  edition: EditionCode;
  sourceSheet: string;
  sourceRow: number;
  evidence: string[];
  rating: Rating;
  status: string;
  scopeReason: string;
  recordId: string;
}

export function parseSgMatches(ws: Grid): { rows: SgMatchRow[]; skipped: SkippedRow[]; counts: Record<string, number> } {
  const hdr = headerMap(ws);
  const rows: SgMatchRow[] = [];
  const skipped: SkippedRow[] = [];
  const counts: Record<string, number> = {};
  const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  for (let r = HEADER_ROW + 1; r <= ws.rowCount; r++) {
    const get = reader(ws, hdr, r);
    const sgId = get('SG ID');
    if (!sgId) continue;
    const label = get('Product edition');
    bump(`rows: ${label}`);
    const edition = EDITION_BY_LABEL[label];
    if (edition === null) {
      bump('dropped: PR1ME NZ');
      continue;
    }
    if (edition === undefined) {
      skipped.push({ sheet: ws.name, row: r, reason: `unknown edition "${label}"` });
      continue;
    }
    const sourceSheet = get('Source sheet');
    if (sourceSheet === 'Missing Practices') {
      bump('dropped: PH Missing Practices');
      skipped.push({ sheet: ws.name, row: r, reason: 'source is PH "Missing Practices" sheet (dropped by decision)', sample: sgId });
      continue;
    }
    const status = get('Match status');
    const rating = SG_STATUS_TO_RATING[status];
    if (!rating) {
      skipped.push({ sheet: ws.name, row: r, reason: `unknown match status "${status}"`, sample: sgId });
      continue;
    }
    rows.push({
      row: r,
      sgId,
      edition,
      sourceSheet,
      sourceRow: Number(get('Objective cell').replace(/\D/g, '')),
      evidence: get('Matching evidence', true).split('\n').map(clean).filter(Boolean),
      rating,
      status,
      scopeReason: get('Scope / reason'),
      recordId: get('Product record ID'),
    });
  }
  return { rows, skipped, counts };
}

/**
 * Which of a location's objectives a crosswalk row quotes. The crosswalk split cells on every newline,
 * so quoted lines may be fragments of one wrapped objective: an objective counts as quoted when its
 * normalised text appears inside the joined evidence, or when one evidence line is very similar to it.
 */
export function resolveEvidence(evidence: string[], objectives: string[]): { matched: string[]; unmatchedLines: string[] } {
  const joined = ' ' + evidence.map(normText).join(' ') + ' ';
  const matched = objectives.filter((o) => {
    const n = normText(o);
    return n.length > 0 && joined.includes(' ' + n + ' ');
  });
  for (const line of evidence) {
    for (const o of objectives) if (!matched.includes(o) && textSimilarity(line, o) >= 0.85) matched.push(o);
  }
  const unmatchedLines = evidence.filter((line) => {
    const n = normText(line);
    return !matched.some((o) => normText(o).includes(n) || textSimilarity(line, o) >= 0.85);
  });
  return { matched, unmatchedLines };
}

export interface ResolvedSgRow extends SgMatchRow {
  location: ParsedLocation | null;
  objectives: string[];
  link: 'bullet' | 'lesson' | 'unlinked';
  /** Quoted lines that matched none of the location's objectives. */
  unmatchedLines: string[];
}

export function resolveSgRows(rows: SgMatchRow[], parsed: Record<EditionCode, ParseResult>): ResolvedSgRow[] {
  const locByKey = new Map<string, ParsedLocation>();
  for (const [ed, p] of Object.entries(parsed)) for (const l of p.locations) locByKey.set(`${ed}|${l.key}`, l);
  return rows.map((row) => {
    const key = parsed[row.edition].rowIndex.get(`${row.sourceSheet}|${row.sourceRow}`);
    const location = key ? (locByKey.get(`${row.edition}|${key}`) ?? null) : null;
    if (!location) return { ...row, location: null, objectives: [], link: 'unlinked' as const, unmatchedLines: row.evidence };
    const delivered = location.delivers.map((d) => d.text);
    const { matched, unmatchedLines } = resolveEvidence(row.evidence, delivered);
    // PH rows quote the PH wording; when it was linked to a differently-worded PINE bullet, map it across.
    const sourceObjectives = location.meta.sourceObjectives as string[] | undefined;
    if (!matched.length && sourceObjectives?.length === location.delivers.length) {
      for (const o of resolveEvidence(row.evidence, sourceObjectives).matched) {
        const d = delivered[sourceObjectives.indexOf(o)];
        if (d && !matched.includes(d)) matched.push(d);
      }
    }
    const stillUnmatched = unmatchedLines.filter((line) => !matched.some((o) => textSimilarity(line, o) >= 0.85 || normText(o).includes(normText(line))));
    if (!matched.length) return { ...row, location, objectives: [], link: 'lesson' as const, unmatchedLines: row.evidence };
    return { ...row, location, objectives: matched, link: 'bullet' as const, unmatchedLines: stillUnmatched };
  });
}
