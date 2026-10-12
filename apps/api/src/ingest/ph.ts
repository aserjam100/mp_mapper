import type ExcelJS from 'exceljs';
import { bestMatch, clean, isLettered, splitObjectives, splitPhCodes } from '@mapper/shared';
import { cellColours, cellText, getSheet } from './excel.js';
import { pineLessonKey } from './pine.js';
import type { ParsedLocation, ParseResult } from './types.js';

export const PH_FILE = 'PH DPA S&S_Final_2 Jan 2024 1 (1).xlsx';
export const PH_GRADE_SHEETS = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6'];
export const PH_OPTIONAL_SHEET = 'OPTIONAL';

// Grade sheets, 1-based columns, data from row 3
const COL = {
  chapter: 1, unit: 2, lesson: 3, ref: 4, title: 5, objective: 6, chapterAssessment: 7, review: 8, midYearEoy: 9,
  code: 11, codeText: 13, phId: 16, phTitle: 17, activityType: 19, productCode: 20, page: 24, strand: 25,
  subStrand: 26, status: 42,
} as const;

const PINE_REF = /^PINE_G(\d)_C0*(\d+[A-Z]?)_P(\w+)\.(\w+)\.(\w+)$/i;
/** PH objective wording counts as "the same" PINE bullet at or above this similarity. */
export const SAME_OBJECTIVE = 0.85;

export interface PhLinkStats {
  sheet: string;
  activities: number;
  linkedToPine: number;
  sameObjective: number;
  rewordedObjective: number;
  phNative: number;
  blankRef: number;
  badRef: number;
}

const ORANGE = new Set(['FFFBE4D5', 'FFFCE4D6']);
/** Column-D colour legend at the bottom of each grade sheet. */
export function reuseQualityFromColours(fill: string | null, font: string | null): string | null {
  if (font === 'FFC00000') return 'new';
  if (fill === 'FF92D050') return 'vendor_pending';
  if (fill === 'FF9CC2E5') return 'settled';
  if (fill && ORANGE.has(fill)) return font === 'FFFF0000' ? 'match' : 'good';
  if (!fill || fill === 'FFFFFFFF') return font === null || font === 'FF000000' ? 'exact' : font === 'FFFF0000' ? 'match' : null;
  return null;
}

const parseLabel = (s: string, re: RegExp) => {
  const m = re.exec(s);
  return m ? { no: m[1].toUpperCase(), title: clean(m[2]) } : s ? { no: null, title: s } : null;
};

export function parsePh(wb: ExcelJS.Workbook, pine: ParseResult, sourceFile = PH_FILE): ParseResult & { linkStats: PhLinkStats[] } {
  const res: ParseResult & { linkStats: PhLinkStats[] } = { locations: [], skipped: [], notes: [], rowIndex: new Map(), linkStats: [] };
  const pineByKey = new Map(pine.locations.map((l) => [l.key, l]));
  const usedKeys = new Set<string>();

  const uniqueKey = (k: string, sheet: string, row: number) => {
    if (!usedKeys.has(k)) {
      usedKeys.add(k);
      return k;
    }
    res.notes.push(`${sheet} row ${row}: duplicate activity key ${k}; kept with row suffix`);
    const k2 = `${k}|${sheet}|r${row}`;
    usedKeys.add(k2);
    return k2;
  };

  /** Resolve the PINE reference and link objectives; returns content + delivers + own objectives. */
  function link(ref: string, objectives: string[], stats: PhLinkStats, fallbackKey: string, title: string) {
    const refs = ref.split(/[\/\s]+/).filter(Boolean);
    const m = refs.length ? PINE_REF.exec(refs[0]) : null;
    if (refs.length > 1) res.notes.push(`Activity reference "${ref}" holds ${refs.length} references; used the first`);
    const pineLoc = m ? pineByKey.get(pineLessonKey(Number(m[1]), m[2], `${m[3]}.${m[4]}`)) : undefined;
    if (!ref) stats.blankRef++;
    else if (/^PH_/i.test(ref)) stats.phNative++;
    else if (!pineLoc) {
      stats.badRef++;
      res.notes.push(`Unresolved PINE reference "${ref}"`);
    }
    if (!pineLoc) {
      return {
        content: { edition: 'PH_DPA' as const, key: fallbackKey, title, kind: 'activity' as const },
        ownObjectives: objectives,
        delivers: objectives.map((text) => ({ text, link: 'direct' as const })),
        pine: null,
      };
    }
    stats.linkedToPine++;
    const own: string[] = [];
    const delivers: ParsedLocation['delivers'] = [];
    for (const o of objectives) {
      const best = bestMatch(o, pineLoc.ownObjectives, SAME_OBJECTIVE);
      if (best) {
        delivers.push({ text: pineLoc.ownObjectives[best.index], link: 'direct' });
      } else {
        own.push(o);
        delivers.push({ text: o, link: 'reworded_of' });
      }
    }
    if (own.length) stats.rewordedObjective++;
    else stats.sameObjective++;
    return { content: pineLoc.content, ownObjectives: own, delivers, pine: pineLoc };
  }

  // ------------------------------------------------------------ Grade 1-6 sheets
  for (const sheet of PH_GRADE_SHEETS) {
    const ws = getSheet(wb, sheet);
    const grade = Number(sheet.slice(-1));
    const stats: PhLinkStats = { sheet, activities: 0, linkedToPine: 0, sameObjective: 0, rewordedObjective: 0, phNative: 0, blankRef: 0, badRef: 0 };
    let chapter = '';
    let unit = '';
    let lesson = '';
    for (let r = 3; r <= ws.rowCount; r++) {
      const v = (c: number) => clean(cellText(ws.getCell(r, c)));
      const a = v(COL.chapter);
      if (a && a !== chapter) {
        chapter = a;
        unit = '';
        lesson = '';
      }
      if (v(COL.unit)) unit = v(COL.unit);
      if (v(COL.lesson)) lesson = v(COL.lesson);
      const ref = v(COL.ref);
      const objectiveCell = cellText(ws.getCell(r, COL.objective));
      if (!ref && !clean(objectiveCell) && !v(COL.title)) {
        const any = [COL.chapter, COL.unit, COL.lesson, COL.code, COL.phId].map(v).filter(Boolean);
        if (a === 'Text') res.skipped.push({ sheet, row: r, reason: 'colour legend row', sample: v(COL.unit) });
        else if (any.length) res.skipped.push({ sheet, row: r, reason: 'no activity reference, title or objective', sample: any.join(' | ').slice(0, 80) });
        continue;
      }
      if (ref && !/^(PINE|PH)_/i.test(ref)) {
        res.skipped.push({ sheet, row: r, reason: /cell|colou?r/i.test(ref) ? 'colour legend row' : 'non-reference text in activity reference column', sample: ref.slice(0, 80) });
        continue;
      }
      stats.activities++;
      const objectives = splitObjectives(objectiveCell);
      const phId = v(COL.phId);
      const title = v(COL.phTitle) || v(COL.title);
      const key = uniqueKey(phId || `${sheet}|${ref || 'r' + r}`, sheet, r);
      const l = link(ref, objectives, stats, key, title);
      const ch = parseLabel(chapter, /^Chapter\s+(\d+[A-Z]?)\s*:\s*(.*)$/i);
      const un = parseLabel(unit, /^Unit\s+(\w+)\s*:\s*(.*)$/i);
      const le = parseLabel(lesson, /^(\w+\.\w+)\s+(.*)$/);
      const codes = splitPhCodes(cellText(ws.getCell(r, COL.code)));
      const colours = cellColours(ws.getCell(r, COL.ref));
      const loc: ParsedLocation = {
        edition: 'PH_DPA',
        key,
        content: l.content,
        ownObjectives: l.ownObjectives,
        delivers: l.delivers,
        gradeNum: grade,
        chapterNo: ch?.no ?? null,
        chapterTitle: ch?.title ?? null,
        unitNo: un?.no ?? null,
        unitTitle: un?.title ?? null,
        lessonNo: le?.no ?? null,
        lessonTitle: le?.title ?? null,
        activityRef: ref || null,
        externalId: phId || null,
        activityTitle: title || null,
        type: /mind stretcher/i.test(lesson) ? 'problem_solving' : 'practice',
        optional: false,
        supplement: isLettered(ch?.no) || isLettered(un?.no) || isLettered(le?.no),
        reuseQuality: l.pine ? reuseQualityFromColours(colours.fill, colours.font) : null,
        sortKey: `G${grade}|${sheet}|r${String(r).padStart(5, '0')}`,
        sourceFile,
        sourceSheet: sheet,
        sourceRow: r,
        meta: {
          pineGrade: l.pine?.gradeNum ?? null,
          pineLocationKey: l.pine?.key ?? null,
          chapterAssessment: v(COL.chapterAssessment) || null,
          review: v(COL.review) || null,
          midYearEoy: v(COL.midYearEoy) || null,
          activityType: v(COL.activityType) || null,
          productCode: v(COL.productCode) || null,
          page: v(COL.page) || null,
          phStrand: v(COL.strand) || null,
          phSubStrand: v(COL.subStrand) || null,
          publishStatus: v(COL.status) || null,
          refColours: colours,
          phCodeText: v(COL.codeText) || null,
          sourceObjectives: objectives,
        },
        codes: codes.map((code) => ({
          code,
          objectiveText: l.delivers.length === 1 ? l.delivers[0].text : null,
          sourceRow: r,
        })),
      };
      res.locations.push(loc);
      res.rowIndex.set(`${sheet}|${r}`, key);
    }
    res.linkStats.push(stats);
  }

  // ------------------------------------------------------------ OPTIONAL (hidden sheet, no header row)
  const ws = getSheet(wb, PH_OPTIONAL_SHEET);
  const stats: PhLinkStats = { sheet: PH_OPTIONAL_SHEET, activities: 0, linkedToPine: 0, sameObjective: 0, rewordedObjective: 0, phNative: 0, blankRef: 0, badRef: 0 };
  let grade = 0;
  let chapter = '';
  let unit = '';
  let lesson = '';
  for (let r = 1; r <= ws.rowCount; r++) {
    const v = (c: number) => clean(cellText(ws.getCell(r, c)));
    const gm = /^GRADE (\d)$/i.exec(v(1));
    if (gm) {
      grade = Number(gm[1]);
      chapter = unit = lesson = '';
      continue;
    }
    if (!grade) continue;
    const codes = new Set<string>();
    for (let c = 7; c <= 27; c++) for (const code of splitPhCodes(cellText(ws.getCell(r, c)))) codes.add(code);
    if (v(1) && v(1) !== chapter) {
      chapter = v(1);
      unit = lesson = '';
    }
    if (v(2)) unit = v(2);
    if (v(3)) lesson = v(3);
    const ref = v(4);
    const objectiveCell = cellText(ws.getCell(r, 6));
    if (!ref && !clean(objectiveCell)) {
      if (codes.size) res.skipped.push({ sheet: ws.name, row: r, reason: 'PH competency listed with no activity (gap)', sample: [...codes].join(', ') });
      else if (v(1) || v(2) || v(3)) res.skipped.push({ sheet: ws.name, row: r, reason: 'heading-only row', sample: [v(1), v(2), v(3)].filter(Boolean).join(' | ') });
      continue;
    }
    if (ref && !/^(PINE|PH)_/i.test(ref)) {
      res.skipped.push({ sheet: ws.name, row: r, reason: 'note text in activity reference column', sample: ref.slice(0, 80) });
      continue;
    }
    stats.activities++;
    const objectives = splitObjectives(objectiveCell);
    const title = v(5);
    const key = uniqueKey(`OPTIONAL|${ref || 'G' + grade + '|r' + r}`, ws.name, r);
    const l = link(ref, objectives, stats, key, title);
    const refM = PINE_REF.exec(ref);
    const un = parseLabel(unit, /^Unit\s+(\w+)\s*:\s*(.*)$/i);
    const le = parseLabel(lesson, /^(\w+\.\w+)\s+(.*)$/);
    const ch = parseLabel(chapter, /^Chapter\s+(\d+[A-Z]?)\s*:\s*(.*)$/i);
    res.locations.push({
      edition: 'PH_DPA',
      key,
      content: l.content,
      ownObjectives: l.ownObjectives,
      delivers: l.delivers,
      gradeNum: grade,
      chapterNo: ch?.no ?? (refM ? refM[2].toUpperCase() : null),
      chapterTitle: ch?.title ?? null,
      unitNo: un?.no ?? null,
      unitTitle: un?.title ?? null,
      lessonNo: le?.no ?? null,
      lessonTitle: le?.title ?? null,
      activityRef: ref || null,
      externalId: null,
      activityTitle: title || null,
      type: /mind stretcher/i.test(lesson) ? 'problem_solving' : 'practice',
      optional: true,
      supplement: isLettered(un?.no) || isLettered(le?.no),
      reuseQuality: null,
      sortKey: `G${grade}|OPTIONAL|r${String(r).padStart(5, '0')}`,
      sourceFile,
      sourceSheet: ws.name,
      sourceRow: r,
      meta: { pineGrade: l.pine?.gradeNum ?? null, pineLocationKey: l.pine?.key ?? null, sourceObjectives: objectives },
      codes: [...codes].map((code) => ({ code, objectiveText: l.delivers.length === 1 ? l.delivers[0].text : null, sourceRow: r })),
    });
    res.rowIndex.set(`${ws.name}|${r}`, key);
  }
  res.linkStats.push(stats);
  return res;
}
