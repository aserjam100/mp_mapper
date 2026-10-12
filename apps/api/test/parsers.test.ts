import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseAu } from '../src/ingest/au.js';
import { loadGrids, loadWorkbook } from '../src/ingest/excel.js';
import { parsePh, reuseQualityFromColours } from '../src/ingest/ph.js';
import { parsePhCurriculum } from '../src/ingest/phCurriculum.js';
import { parsePine } from '../src/ingest/pine.js';
import { parseSgMatches, parseSgObjectives, resolveSgRows, resolveEvidence } from '../src/ingest/sg.js';
import type { ParseResult } from '../src/ingest/types.js';

const F = (f: string) => resolve(import.meta.dirname, 'fixtures', f);
let pine: ParseResult;
let au: ParseResult;
let ph: Awaited<ReturnType<typeof parsePh>>;

beforeAll(async () => {
  pine = parsePine(await loadWorkbook(F('pine.xlsx')));
  au = parseAu(await loadWorkbook(F('au.xlsx')));
  ph = parsePh(await loadWorkbook(F('ph.xlsx')), pine);
});

describe('PINE parser', () => {
  it('fills chapter and unit down and splits bullets', () => {
    const l = pine.locations.find((x) => x.key === 'G1|C1|L1.1')!;
    expect(l.chapterTitle).toBe('Numbers 0 to 10');
    expect(l.unitTitle).toBe('Counting and Comparing');
    expect(l.lessonTitle).toBe('Counting, reading and writing numbers');
    expect(l.ownObjectives).toEqual([
      'Count within 10 (including the use of zero)',
      'Read and write a number from 0 to 10—the numeral and the corresponding number word',
      'Recognize conservation of numbers',
    ]);
    expect(l.type).toBe('teaching');
    expect(l.sourceRow).toBe(7);
  });

  it("keeps Let's Remember (both apostrophes) as review content", () => {
    const lr = pine.locations.filter((x) => x.type === 'review');
    expect(lr.length).toBeGreaterThanOrEqual(2);
    expect(lr[0].ownObjectives).toEqual(['Count up to 5 objects arranged in different ways']);
    expect(lr[0].unitNo).toBeNull();
  });

  it('joins wrapped lines and treats unbulleted cells as one objective', () => {
    const half = pine.locations.find((x) => x.sourceRow === 211 && x.sourceSheet === 'Grade 1')!;
    expect(half.ownObjectives[0]).toBe('Find one half of a small number of objects by putting the objects into 2 equal groups');
    const make10 = pine.locations.find((x) => x.sourceRow === 32 && x.sourceSheet === 'Grade 1')!;
    expect(make10.ownObjectives).toEqual(['Make 10']);
  });

  it('flags lettered units/lessons as supplements', () => {
    const l = pine.locations.find((x) => x.lessonNo === '2A.1' && x.gradeNum === 1)!;
    expect(l.unitNo).toBe('2A');
    expect(l.supplement).toBe(true);
    expect(pine.locations.find((x) => x.lessonNo === '1.A' && x.gradeNum === 5)?.supplement).toBe(true);
  });

  it('marks Mind stretcher lessons as problem solving and indexes rows', () => {
    expect(pine.locations.some((x) => x.type === 'problem_solving')).toBe(true);
    expect(pine.rowIndex.get('Grade 1|7')).toBe('G1|C1|L1.1');
  });
});

describe('AU parser', () => {
  it('skips book headers and book separator rows', () => {
    const reasons = au.skipped.map((s) => s.reason);
    expect(reasons).toContain('book header row');
    expect(reasons).toContain('book separator row (only book column filled)');
  });

  it("maps Let's Remember codes per bullet", () => {
    const lr = au.locations.find((l) => l.book === '1A' && l.type === 'review')!;
    expect(lr.ownObjectives).toContain('To count and write a number within 10');
    expect(lr.codes).toContainEqual({ code: 'AC9MFN01', objectiveText: 'To count and write a number within 10', sourceRow: 6 });
  });

  it('collects continuation-row codes on the lesson as whole-lesson mappings', () => {
    const l = au.locations.find((x) => x.lessonTitle === 'Multiplying by 3')!;
    expect(l.sourceRow).toBe(1810);
    expect(l.codes.map((c) => c.code).sort()).toEqual(['AC9M3A03', 'AC9M3N04']);
    expect(l.codes.every((c) => c.objectiveText === null)).toBe(true);
    expect(au.rowIndex.get('PR1ME AUS 1-6 objectives|1812')).toBe(l.key);
  });

  it('attaches Hub practice pages to their Bk lesson and folds their codes', () => {
    const lesson = au.locations.find((x) => x.lessonTitle === 'Making 5, 6 or 7')!;
    const hub = au.locations.filter((x) => x.type === 'practice' && x.parentKey === lesson.key);
    expect(hub.map((h) => h.lessonTitle).sort()).toEqual(['More Practice', 'Think About It']);
    expect(hub[0].content.key).toBe(lesson.content.key);
    expect(hub[0].codes).toEqual([]);
    expect(lesson.codes.map((c) => c.code)).toContain('AC9M1N02');
  });

  it('keeps Year 7 codes used in Year 4 books (4B row 2519)', () => {
    const l = au.locations.find((x) => x.sourceRow === 2519)!;
    expect(l.book).toBe('4B');
    expect(l.gradeNum).toBe(4);
    expect(l.codes.map((c) => c.code)).toEqual(['AC9M7N05']);
  });
});

describe('PH parser', () => {
  it('links PINE activity references to PINE lessons, even when PH renumbers lessons', () => {
    const a = ph.locations.find((l) => l.externalId === 'PH_G1_C01_P1.2.1')!;
    expect(a.activityRef).toBe('PINE_G1_C01_P1.3.1');
    expect(a.lessonNo).toBe('1.2');
    expect(a.content).toEqual(pine.locations.find((l) => l.key === 'G1|C1|L1.3')!.content);
    expect(a.meta.pineLocationKey).toBe('G1|C1|L1.3');
  });

  it('reuses the PINE bullet when the wording matches, keeps PH wording otherwise', () => {
    const same = ph.locations.find((l) => l.externalId === 'PH_G1_C01_P1.1.3')!;
    expect(same.delivers).toEqual([{ text: 'Recognize conservation of numbers', link: 'direct' }]);
    expect(same.ownObjectives).toEqual([]);
    const reworded = ph.locations.find((l) => l.externalId === 'PH_G1_C01_P1.1.1')!;
    expect(reworded.delivers[0].link).toBe('reworded_of');
    expect(reworded.ownObjectives[0]).toMatch(/^To count within 10/);
  });

  it('treats PH_ references as PH-native content', () => {
    const native = ph.locations.find((l) => l.activityRef?.startsWith('PH_'))!;
    expect(native.content.edition).toBe('PH_DPA');
    expect(native.ownObjectives.length).toBeGreaterThan(0);
  });

  it('resolves lettered PINE chapters (C15A)', () => {
    const a = ph.locations.find((l) => l.activityRef?.startsWith('PINE_G1_C15A'))!;
    expect(a.meta.pineLocationKey).toMatch(/^G1\|C15A\|/);
  });

  it('reads PH codes, the colour legend and skips legend rows', () => {
    const a = ph.locations.find((l) => l.externalId === 'PH_G1_C01_P1.1.1')!;
    expect(a.codes.map((c) => c.code)).toEqual(['M1NS-Ia-1.1']);
    expect(a.reuseQuality).toBe('exact');
    expect(ph.skipped.filter((s) => s.reason === 'colour legend row').length).toBeGreaterThanOrEqual(6);
    expect(ph.locations.some((l) => /cell/i.test(l.activityRef ?? ''))).toBe(false);
  });

  it('keeps an activity with a blank reference as PH-native (Grade 4 row 83)', () => {
    const a = ph.locations.find((l) => l.sourceSheet === 'Grade 4' && l.sourceRow === 83)!;
    expect(a.activityRef).toBeNull();
    expect(a.content.edition).toBe('PH_DPA');
  });

  it('reads the hidden OPTIONAL sheet with grade markers and the optional flag', () => {
    const opt = ph.locations.filter((l) => l.sourceSheet === 'OPTIONAL');
    expect(opt.length).toBeGreaterThan(0);
    expect(opt.every((l) => l.optional && l.gradeNum === 1)).toBe(true);
    expect(opt.find((l) => l.activityRef === 'PINE_G2_C09_P1.1.1')?.codes.map((c) => c.code)).toEqual(['M1AL-IIIh-8']);
    // rows 101-105 list a PH competency with no activity: recorded as gaps, not activities
    expect(ph.skipped.filter((s) => s.sheet === 'OPTIONAL' && s.reason.includes('gap')).map((s) => s.row)).toEqual([101, 102, 103, 104, 105]);
  });

  it('reuse quality legend mapping', () => {
    expect(reuseQualityFromColours(null, null)).toBe('exact');
    expect(reuseQualityFromColours('FFFBE4D5', null)).toBe('good');
    expect(reuseQualityFromColours('FFFBE4D5', 'FFFF0000')).toBe('match');
    expect(reuseQualityFromColours('FFFBE4D5', 'FFC00000')).toBe('new');
    expect(reuseQualityFromColours('FF92D050', 'FFC00000')).toBe('new');
    expect(reuseQualityFromColours('FF92D050', null)).toBe('vendor_pending');
  });
});

describe('PH Curriculum sheet', () => {
  it('reads the grade grid, strips numbering and stops at the summary', async () => {
    const { objectives } = parsePhCurriculum(await loadWorkbook(F('ph.xlsx')));
    const c = objectives.find((o) => o.code === 'M1NS-Ia-1.1')!;
    expect(c.gradeNum).toBe(1);
    expect(c.objectiveNo).toBe('1');
    expect(c.strand).toBe('Numbers and Number Sense');
    expect(c.text).toMatch(/^Visualizes and represents numbers from 0/);
    expect(objectives.find((o) => o.code === 'M1NS-Id-5')).toBeTruthy(); // "M1NS- Id-5" in the sheet
    expect(objectives.some((o) => /^\d/.test(o.code ?? ''))).toBe(false);
  });
});

describe('SG crosswalk', () => {
  it('reads SG objectives and drops NZ and Missing Practices rows', async () => {
    const g = await loadGrids(F('sg.xlsx'), ['SG objectives', 'Match detail']);
    const objs = parseSgObjectives(g.get('SG objectives')!);
    expect(objs[0]).toMatchObject({ key: 'SG-P1-001', gradeLabel: 'P1', gradeNum: 1, track: 'Standard' });
    const m = parseSgMatches(g.get('Match detail')!);
    expect(m.counts['dropped: PR1ME NZ']).toBe(1);
    expect(m.counts['dropped: PH Missing Practices']).toBe(1);
    expect(m.rows.every((r) => r.edition !== undefined)).toBe(true);
    const res = resolveSgRows(m.rows, { PINE: pine, AU2: au, PH_DPA: ph });
    expect(res.filter((r) => r.link === 'unlinked')).toEqual([]);
    expect(res.every((r) => r.link === 'bullet')).toBe(true);
    const partial = res.find((r) => r.status === 'Partial scope')!;
    expect(partial.rating).toBe('check');
  });

  it('matches quoted evidence split across wrapped lines', () => {
    const objectives = ['Subtract a 1-digit number from a 2-digit number without regrouping using the ‘counting backwards’ method, number bonds and place value', 'Check the answer'];
    const r = resolveEvidence(['Subtract a 1-digit number from a 2-digit number without regrouping using the', '‘counting backwards’ method, number bonds and place value'], objectives);
    expect(r.matched).toEqual([objectives[0]]);
  });
});
