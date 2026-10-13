import { describe, expect, it } from 'vitest';
import { parseGrade } from './grades.js';

describe('parseGrade', () => {
  it('reads common grade labels', () => {
    expect(parseGrade('Grade 3')).toBe(3);
    expect(parseGrade('P3')).toBe(3);
    expect(parseGrade('Year 10')).toBe(10);
    expect(parseGrade('Primary 6')).toBe(6);
    expect(parseGrade(4)).toBe(4);
    expect(parseGrade('G2')).toBe(2);
  });
  it('reads foundation years as 0', () => {
    expect(parseGrade('Foundation')).toBe(0);
    expect(parseGrade('F')).toBe(0);
    expect(parseGrade('Kindergarten')).toBe(0);
  });
  it('returns null when there is no grade', () => {
    expect(parseGrade('')).toBeNull();
    expect(parseGrade('Number and Algebra')).toBeNull();
  });
});
