import type ExcelJS from 'exceljs';
import { clean, normAc9Code, splitObjectives } from '@mapper/shared';
import { cellText, getSheet } from './excel.js';
import type { ParsedLocation, ParseResult } from './types.js';

export const AU_FILE = 'PR1ME Scope and Sequence_AU2 Y1 to 6 030523.xlsx';
export const AU_SHEET = 'PR1ME AUS 1-6 objectives';

// 1-based columns, header row 4
const COL = {
  book: 1, section: 2, topicNo: 3, topic: 4, unitNo: 5, unit: 6, lessonNo: 7, lesson: 8, objective: 9,
  strand: 10, ac9: 11, contentSource: 17, newUpdate: 18, lessonCount: 19, pageCount: 20, writer: 21,
} as const;

const PRACTICE_TITLES = /^(More Practice|Think About It|Create Your Own)$/i;
const AC9_CODE = /^AC9M(F|\d{1,2})(N|A|M|SP|ST|P)\d{2}$/;

const normSection = (s: string) => {
  const t = clean(s).toLowerCase();
  if (t === 'hub') return 'Hub';
  if (t === 'bk' || t === 'cb') return 'Bk';
  return t ? clean(s) : null;
};

/**
 * One location per (book, topic, unit, lesson, Bk/Hub, lesson title). Rows that repeat the key directly
 * below a lesson are continuation rows: they add AC9 codes (and sometimes bullets) to that lesson.
 * AC9 codes on lesson rows map to the whole lesson; on Let's Remember rows they map to that row's bullet.
 * Hub practice pages (More Practice etc.) deliver their Bk lesson's content, and their codes fold into it.
 */
export function parseAu(wb: ExcelJS.Workbook, sourceFile = AU_FILE): ParseResult {
  const res: ParseResult = { locations: [], skipped: [], notes: [], rowIndex: new Map() };
  const ws = getSheet(wb, AU_SHEET);
  if (clean(cellText(ws.getCell(4, COL.ac9))) !== 'CD9') res.notes.push('Header row 4: column K is not "CD9"');
  const byKey = new Map<string, ParsedLocation>();
  let lastBook = '';

  for (let r = 5; r <= ws.rowCount; r++) {
    const v = (c: number) => clean(cellText(ws.getCell(r, c)));
    const book = v(COL.book).toUpperCase();
    const topic = v(COL.topic);
    if (/^BOOK\s/i.test(topic)) {
      res.skipped.push({ sheet: ws.name, row: r, reason: 'book header row', sample: topic });
      continue;
    }
    const filled = [COL.section, COL.topicNo, COL.topic, COL.lesson, COL.objective, COL.ac9].some((c) => v(c));
    if (!filled) {
      if (book) res.skipped.push({ sheet: ws.name, row: r, reason: 'book separator row (only book column filled)', sample: book });
      continue;
    }
    if (!book && !lastBook) {
      res.skipped.push({ sheet: ws.name, row: r, reason: 'no book', sample: v(COL.lesson) });
      continue;
    }
    if (!book) res.notes.push(`${ws.name} row ${r}: book cell empty; filled down "${lastBook}"`);
    const bookOf = book || lastBook;
    lastBook = bookOf;
    const year = Number(bookOf[0]);
    const section = normSection(v(COL.section));
    const lessonTitle = v(COL.lesson);
    const lessonNo = v(COL.lessonNo);
    const unitNo = v(COL.unitNo);
    const topicNo = v(COL.topicNo);
    const review = /^Let['’]s Remember/i.test(lessonTitle);
    const practice = PRACTICE_TITLES.test(lessonTitle);
    const key = [bookOf, `T${topicNo}`, `U${unitNo}`, `L${lessonNo}`, section ?? '-', lessonTitle.toLowerCase()].join('|');
    const objectives = splitObjectives(cellText(ws.getCell(r, COL.objective)));
    const code = normAc9Code(cellText(ws.getCell(r, COL.ac9)));

    let loc = byKey.get(key);
    if (!loc) {
      loc = {
        edition: 'AU2',
        key,
        content: { edition: 'AU2', key, title: lessonTitle || '(untitled)', kind: 'lesson' },
        ownObjectives: [],
        delivers: [],
        gradeNum: year,
        book: bookOf,
        chapterNo: topicNo || null,
        chapterTitle: topic || null,
        unitNo: unitNo || null,
        unitTitle: v(COL.unit) || null,
        lessonNo: lessonNo || null,
        lessonTitle: lessonTitle || null,
        section,
        type: review ? 'review' : practice ? 'practice' : /mind stretcher/i.test(lessonTitle) ? 'problem_solving' : 'teaching',
        optional: false,
        supplement: false,
        sortKey: `Y${year}|r${String(r).padStart(5, '0')}`,
        sourceFile,
        sourceSheet: ws.name,
        sourceRow: r,
        meta: {
          strand: v(COL.strand).trim() || null,
          contentSource: v(COL.contentSource) || null,
          newUpdate: v(COL.newUpdate) || null,
          lessonCount: v(COL.lessonCount) || null,
          pageCount: v(COL.pageCount) || null,
          writer: v(COL.writer) || null,
          rows: [] as number[],
        },
        codes: [],
      };
      byKey.set(key, loc);
      res.locations.push(loc);
    }
    (loc.meta.rows as number[]).push(r);
    res.rowIndex.set(`${ws.name}|${r}`, key);

    for (const o of objectives) {
      if (!loc.ownObjectives.some((x) => x === o)) {
        loc.ownObjectives.push(o);
        loc.delivers.push({ text: o, link: 'direct' });
      }
    }
    if (code) {
      if (!AC9_CODE.test(code)) {
        res.notes.push(`${ws.name} row ${r}: unrecognised AC9 code "${code}"`);
        continue;
      }
      // Let's Remember is written one bullet per row with its own code; everything else is lesson-level.
      const objectiveText = review && objectives.length === 1 ? objectives[0] : null;
      if (!loc.codes.some((c) => c.code === code && c.objectiveText === objectiveText)) {
        loc.codes.push({ code, objectiveText, sourceRow: r });
      }
    }
  }

  // Hub practice pages -> parent Bk lesson with the same book/topic/unit/lesson number.
  const lessonsByNumber = new Map<string, ParsedLocation>();
  for (const l of res.locations) {
    if (l.type === 'teaching' || l.type === 'problem_solving') {
      const k = [l.book, l.chapterNo, l.unitNo, l.lessonNo].join('|');
      if (!lessonsByNumber.has(k) || l.section === 'Bk') lessonsByNumber.set(k, l);
    }
  }
  let folded = 0;
  let orphan = 0;
  for (const l of res.locations) {
    if (l.type !== 'practice' || l.ownObjectives.length) continue;
    const parent = lessonsByNumber.get([l.book, l.chapterNo, l.unitNo, l.lessonNo].join('|'));
    if (!parent) {
      orphan++;
      continue;
    }
    l.parentKey = parent.key;
    l.content = parent.content;
    l.delivers = parent.ownObjectives.map((text) => ({ text, link: 'direct' as const }));
    for (const c of l.codes) {
      if (!parent.codes.some((p) => p.code === c.code && p.objectiveText === null)) {
        parent.codes.push({ ...c, objectiveText: null });
        folded++;
      }
    }
    l.meta.foldedCodes = l.codes.map((c) => c.code);
    l.codes = [];
  }
  res.notes.push(`Hub practice pages: AC9 codes folded into parent lessons: ${folded} new code links; ${orphan} practice pages had no parent lesson`);
  return res;
}
