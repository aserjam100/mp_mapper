/**
 * New-curriculum upload: read an Excel/CSV file into plain grids, then turn the rows into curriculum
 * objectives using the columns the user picked (grade, strand, sub-strand, code, objective text).
 */
import { clean, normText, parseGrade, splitObjectives } from '@mapper/shared';
import * as XLSX from 'xlsx';

export interface SheetPreview {
  name: string;
  rowCount: number;
  rows: string[][]; // first rows, for choosing the header row and columns
}

export function readGrids(buf: Buffer): Map<string, string[][]> {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const out = new Map<string, string[][]>();
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name]!, { header: 1, raw: false, defval: '', blankrows: true });
    out.set(name, rows.map((r) => r.map((c) => String(c ?? ''))));
  }
  return out;
}

export function previewSheets(grids: Map<string, string[][]>, n = 30): SheetPreview[] {
  return [...grids].map(([name, rows]) => ({ name, rowCount: rows.length, rows: rows.slice(0, n) }));
}

/** Column indexes (0-based). Grade and text are required. */
export interface ColumnMap {
  grade: number;
  text: number;
  strand?: number | null;
  subStrand?: number | null;
  code?: number | null;
}

export interface ParseOptions {
  headerRow: number; // 1-based row holding the column headings; data starts below it
  columns: ColumnMap;
  /** Split cells holding several bullets/lines into one objective each. */
  splitBullets: boolean;
  /** Fill empty grade/strand cells from the row above (merged cells, grouped layouts). */
  fillDown: boolean;
}

export interface ParsedObjective {
  row: number; // 1-based sheet row
  code: string | null;
  gradeLabel: string;
  gradeNum: number | null;
  strand: string | null;
  subStrand: string | null;
  text: string;
  key: string; // stable identity within the curriculum
}

export interface ParseOutput {
  objectives: ParsedObjective[];
  skipped: { row: number; reason: string }[];
  warnings: string[];
}

export function parseObjectives(rows: string[][], o: ParseOptions): ParseOutput {
  const out: ParseOutput = { objectives: [], skipped: [], warnings: [] };
  const at = (r: string[], i: number | null | undefined) => (i === null || i === undefined || i < 0 ? '' : clean(r[i]));
  let last = { grade: '', strand: '', subStrand: '' };
  const seen = new Map<string, number>();

  for (let i = o.headerRow; i < rows.length; i++) {
    const r = rows[i]!;
    const rowNo = i + 1;
    let grade = at(r, o.columns.grade);
    let strand = at(r, o.columns.strand);
    let subStrand = at(r, o.columns.subStrand);
    if (o.fillDown) {
      grade ||= last.grade;
      strand ||= last.strand;
      subStrand ||= last.subStrand;
      last = { grade, strand, subStrand };
    }
    const rawText = o.columns.text >= 0 ? r[o.columns.text] ?? '' : '';
    if (!clean(rawText)) {
      if (r.some((c) => clean(c))) out.skipped.push({ row: rowNo, reason: 'no objective text' });
      continue;
    }
    if (!grade) {
      out.skipped.push({ row: rowNo, reason: 'no grade' });
      continue;
    }
    const code = at(r, o.columns.code) || null;
    const texts = o.splitBullets ? splitObjectives(rawText) : [clean(rawText)];
    texts.forEach((text, j) => {
      const objCode = code && texts.length > 1 ? `${code}.${j + 1}` : code;
      const key = objCode ?? `${grade}|${normText(text)}`;
      const dup = seen.get(key);
      if (dup) {
        out.skipped.push({ row: rowNo, reason: `duplicate of row ${dup}${objCode ? ` (code ${objCode})` : ''}` });
        return;
      }
      seen.set(key, rowNo);
      out.objectives.push({ row: rowNo, code: objCode, gradeLabel: grade, gradeNum: parseGrade(grade), strand: strand || null, subStrand: subStrand || null, text, key });
    });
  }
  const noGradeNum = out.objectives.filter((x) => x.gradeNum === null).length;
  if (noGradeNum) out.warnings.push(`${noGradeNum} objectives have a grade label with no number in it; they are matched against every grade.`);
  if (!out.objectives.length) out.warnings.push('No objectives found. Check the header row and the text column.');
  return out;
}
