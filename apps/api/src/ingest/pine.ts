import type ExcelJS from 'exceljs';
import { clean, isLettered, splitObjectives } from '@mapper/shared';
import { cellText } from './excel.js';
import type { ParsedLocation, ParseResult } from './types.js';

export const PINE_FILE = 'PINE learning objectives.xlsx';

const CHAPTER = /^Chapter\s+(\d+[A-Z]?)\s*:\s*(.*)$/i;
const UNIT = /^Unit\s+(\w+)\s*:\s*(.*)$/i;
const REVIEW = /^Let['’]s Remember/i;
const LESSON = /^(\w+\.\w+)\s+(.*)$/;

/** Content/location key of a PINE lesson; also used to resolve PH `PINE_G1_C01_P1.1.1` references. */
export const pineLessonKey = (grade: number, chapterNo: string, lessonNo: string) =>
  `G${grade}|C${chapterNo.toUpperCase()}|L${lessonNo.toUpperCase()}`;

export function parsePine(wb: ExcelJS.Workbook, sourceFile = PINE_FILE): ParseResult {
  const res: ParseResult = { locations: [], skipped: [], notes: [], rowIndex: new Map() };
  const seen = new Set<string>();

  for (const ws of wb.worksheets) {
    const gm = /^Grade (\d)$/.exec(ws.name.trim());
    if (!gm) {
      res.notes.push(`Ignored sheet "${ws.name}"`);
      continue;
    }
    const grade = Number(gm[1]);
    if (clean(cellText(ws.getCell('A3'))) !== 'Lesson') res.notes.push(`${ws.name}: header row 3 is not "Lesson"`);
    let chapter: { no: string; title: string } | null = null;
    let unit: { no: string; title: string } | null = null;

    for (let r = 4; r <= ws.rowCount; r++) {
      const a = clean(cellText(ws.getCell(r, 1)));
      const b = cellText(ws.getCell(r, 2));
      if (!a && !clean(b)) continue;
      // Grades 5-6 report 15 columns but C..O are empty; flag anything that appears there.
      for (let c = 3; c <= ws.columnCount; c++) {
        const t = clean(cellText(ws.getCell(r, c)));
        if (t) res.notes.push(`${ws.name}!${ws.getCell(r, c).address}: unexpected value "${t.slice(0, 40)}"`);
      }

      let m = CHAPTER.exec(a);
      if (m) {
        chapter = { no: m[1].toUpperCase(), title: clean(m[2]) };
        unit = null;
        continue;
      }
      m = UNIT.exec(a);
      if (m) {
        unit = { no: m[1].toUpperCase(), title: clean(m[2]) };
        continue;
      }
      if (!chapter) {
        res.skipped.push({ sheet: ws.name, row: r, reason: 'row before first chapter heading', sample: a });
        continue;
      }

      const objectives = splitObjectives(b);
      const review = REVIEW.test(a);
      const lm = LESSON.exec(a);
      if (!review && !lm) {
        res.skipped.push({ sheet: ws.name, row: r, reason: 'unrecognised lesson label', sample: a });
        continue;
      }
      const lessonNo = review ? 'LR' : lm![1].toUpperCase();
      const lessonTitle = review ? "Let's Remember" : clean(lm![2]);
      let key = pineLessonKey(grade, chapter.no, lessonNo);
      if (seen.has(key)) {
        res.notes.push(`${ws.name} row ${r}: duplicate lesson key ${key}; kept with row suffix`);
        key = `${key}|r${r}`;
      }
      seen.add(key);
      if (!objectives.length) res.notes.push(`${ws.name} row ${r}: lesson "${a}" has no objectives`);

      const loc: ParsedLocation = {
        edition: 'PINE',
        key,
        content: { edition: 'PINE', key, title: lessonTitle, kind: 'lesson' },
        ownObjectives: objectives,
        delivers: objectives.map((text) => ({ text, link: 'direct' as const })),
        gradeNum: grade,
        chapterNo: chapter.no,
        chapterTitle: chapter.title,
        unitNo: review ? null : (unit?.no ?? null),
        unitTitle: review ? null : (unit?.title ?? null),
        lessonNo: review ? null : lessonNo,
        lessonTitle,
        type: review ? 'review' : /mind stretcher/i.test(lessonTitle) ? 'problem_solving' : 'teaching',
        optional: false,
        supplement: isLettered(chapter.no) || (!review && (isLettered(unit?.no) || isLettered(lessonNo))),
        sortKey: `G${grade}|r${String(r).padStart(5, '0')}`,
        sourceFile,
        sourceSheet: ws.name,
        sourceRow: r,
        meta: {},
        codes: [],
      };
      res.locations.push(loc);
      res.rowIndex.set(`${ws.name}|${r}`, key);
    }
  }
  return res;
}
