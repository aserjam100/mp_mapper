import { describe, expect, it } from 'vitest';
import { normText, splitObjectives, splitPhCodes, isLettered, ac9Year } from './text.js';

describe('splitObjectives', () => {
  it('splits tab and space bullets', () => {
    expect(splitObjectives('•\tCount within 10\n•\tRecognize conservation of numbers')).toEqual([
      'Count within 10',
      'Recognize conservation of numbers',
    ]);
  });
  it('joins wrapped lines to the bullet before (PINE G1 row 211)', () => {
    expect(splitObjectives('•\tFind one half by putting the objects into\n2 equal groups\n•\tUse the fraction 1/2')).toEqual([
      'Find one half by putting the objects into 2 equal groups',
      'Use the fraction 1/2',
    ]);
  });
  it('joins e.g. lines (PINE G2 row 132)', () => {
    expect(splitObjectives('•\tUse the = sign to represent equality,\ne.\tg. 16 + 4 = 17 + 3')).toEqual([
      'Use the = sign to represent equality, e. g. 16 + 4 = 17 + 3',
    ]);
  });
  it('treats a cell without bullets as one objective', () => {
    expect(splitObjectives('Make 10')).toEqual(['Make 10']);
  });
  it('splits PH "To …" lines and joins wrapped ones', () => {
    expect(splitObjectives('To count by sixes\nTo multiply numbers within the table of 6')).toHaveLength(2);
    expect(splitObjectives('Identify the value of each\ndigit in a 4-digit number')).toEqual([
      'Identify the value of each digit in a 4-digit number',
    ]);
    expect(splitObjectives('To write a 6-digit number in terms of thousands\n(write a 6-digit number in expanded form)')).toHaveLength(1);
  });
});

describe('normText', () => {
  it('drops "to", quotes and case', () => {
    expect(normText('To use the ‘counting on’ method.')).toBe(normText("Use the 'counting on' method"));
  });
});

describe('codes', () => {
  it('splits and cleans PH codes', () => {
    expect(splitPhCodes('M5ME-IVa-72/M5ME-IVa-73')).toEqual(['M5ME-IVa-72', 'M5ME-IVa-73']);
    expect(splitPhCodes('M1NS- Id-5 ')).toEqual(['M1NS-Id-5']);
    expect(splitPhCodes('M4NS-IIc_x0002_68.1')).toEqual(['M4NS-IIc-68.1']);
  });
  it('reads AC9 years and lettered labels', () => {
    expect(ac9Year('AC9MFN01')).toBe(0);
    expect(ac9Year('AC9M7N05')).toBe(7);
    expect(isLettered('15A')).toBe(true);
    expect(isLettered('1.A')).toBe(true);
    expect(isLettered('3.2')).toBe(false);
  });
});
