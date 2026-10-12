import type ExcelJS from 'exceljs';
import { clean, phGrade, splitPhCodes } from '@mapper/shared';
import { cellColours, cellText, getSheet } from './excel.js';
import type { ParsedCurriculumObjective } from './types.js';

export const PH_CURRICULUM_SHEET = 'PH Curriculum';

/**
 * The `PH Curriculum` sheet is a grid: column A = content strand (filled down), then one
 * (LEARNING COMPETENCY, CODE) column pair per grade starting at B/C. Header rows 1-2.
 */
export function parsePhCurriculum(wb: ExcelJS.Workbook): { objectives: ParsedCurriculumObjective[]; notes: string[] } {
  const ws = getSheet(wb, PH_CURRICULUM_SHEET);
  const notes: string[] = [];
  const pairs: { grade: number; textCol: number; codeCol: number }[] = [];
  for (let c = 2; c <= ws.columnCount; c++) {
    const m = /^Grade (\d)$/.exec(clean(cellText(ws.getCell(1, c))));
    if (m && clean(cellText(ws.getCell(2, c + 1))).toUpperCase() === 'CODE') pairs.push({ grade: Number(m[1]), textCol: c, codeCol: c + 1 });
  }
  if (pairs.length !== 6) notes.push(`PH Curriculum: expected 6 grade column pairs, found ${pairs.length}`);

  const out = new Map<string, ParsedCurriculumObjective>();
  let strand = '';
  for (let r = 3; r <= ws.rowCount; r++) {
    const a = clean(cellText(ws.getCell(r, 1)));
    if (/^Summary$/i.test(a)) break; // totals + colour legend below
    if (a) strand = a;
    for (const p of pairs) {
      const rawText = clean(cellText(ws.getCell(r, p.textCol)));
      const rawCode = cellText(ws.getCell(r, p.codeCol));
      if (!rawText && !clean(rawCode)) continue;
      const codes = splitPhCodes(rawCode);
      if (clean(rawCode) && !codes.length) notes.push(`PH Curriculum row ${r}: unreadable code "${clean(rawCode)}"`);
      if (!codes.length) {
        notes.push(`PH Curriculum row ${r} grade ${p.grade}: competency without code: "${rawText.slice(0, 60)}"`);
        continue;
      }
      // Sheet legend: yellow = competency found in another grade; yellow + red font = unmatched.
      const col = cellColours(ws.getCell(r, p.textCol));
      const sheetFlag = col.fill === 'FFFFFF00' ? (col.font === 'FFFF0000' ? 'unmatched' : 'found_in_another_grade') : null;
      const nm = /^(\d+)\.\s*(.*)$/.exec(rawText);
      const text = nm ? nm[2] : rawText;
      for (const code of codes) {
        if (out.has(code)) {
          notes.push(`PH Curriculum: duplicate code ${code} (row ${r}); kept first`);
          continue;
        }
        const g = phGrade(code);
        if (g !== p.grade) notes.push(`PH Curriculum: ${code} listed under Grade ${p.grade}`);
        out.set(code, {
          key: code,
          code,
          gradeLabel: `Grade ${p.grade}`,
          gradeNum: p.grade,
          strand: strand || null,
          objectiveNo: nm ? nm[1] : null,
          text: text.charAt(0).toUpperCase() + text.slice(1),
          sortKey: `G${p.grade}|${String(Number(nm?.[1] ?? 999)).padStart(4, '0')}|${code}`,
          meta: { sourceRow: r, sheetFlag },
        });
      }
    }
  }
  return { objectives: [...out.values()], notes };
}
