import { describe, expect, it } from 'vitest';
import { compareLimits, extractLimits } from '../src/matching/rules.js';

describe('extractLimits', () => {
  it('reads ranges', () => {
    expect(extractLimits('Add two numbers within 10 using counting on').maxNumber).toBe(10);
    expect(extractLimits('Read and write numbers up to 1 000 000').maxNumber).toBe(1_000_000);
    expect(extractLimits('Reads and writes numbers up to 10 000 000 in symbols and in words.').maxNumber).toBe(10_000_000);
    expect(extractLimits('Count to 1000').maxNumber).toBe(1000);
    expect(extractLimits('Numbers up to 10,000').maxNumber).toBe(10_000);
    expect(extractLimits('numbers up to 10 million').maxNumber).toBe(10_000_000);
  });
  it('reads digit counts (PH M3NS-Ia-10.3)', () => {
    expect(extractLimits('Gives the place value and value of a digit in 4- to 5-digit numbers.').maxNumber).toBe(99_999);
    expect(extractLimits('Identify the value of each digit in a 4-digit number').maxNumber).toBe(9999);
    expect(extractLimits('Multiply a three-digit number by a one-digit number').maxNumber).toBe(999);
  });
  it('does not treat rounding or measures as ranges', () => {
    expect(extractLimits('Round a decimal to 2 decimal places')).toEqual({ decimals: 2 });
    expect(extractLimits('Measure length to 5 cm').maxNumber).toBeUndefined();
  });
  it('reads decimal places', () => {
    expect(extractLimits('Add decimals with up to 3 decimal places').decimals).toBe(3);
    expect(extractLimits('Write tenths and hundredths as decimals').decimals).toBe(2);
    expect(extractLimits('Count in tens')).toEqual({});
  });
});

describe('compareLimits', () => {
  it('flags a narrower lesson', () => {
    expect(compareLimits({ maxNumber: 100_000 }, { maxNumber: 10_000 })).toEqual([
      'Range: curriculum goes to 100 000, lesson only to 10 000',
    ]);
  });
  it('flags a much wider lesson and decimal mismatches', () => {
    expect(compareLimits({ maxNumber: 100 }, { maxNumber: 1000 })[0]).toMatch(/beyond/);
    expect(compareLimits({ decimals: 3 }, { decimals: 2 })).toEqual(['Decimals: curriculum 3 places, lesson 2']);
  });
  it('is silent when either side states no limit', () => {
    expect(compareLimits({ maxNumber: 100 }, {})).toEqual([]);
    expect(compareLimits({ maxNumber: 100 }, { maxNumber: 100 })).toEqual([]);
  });
});
