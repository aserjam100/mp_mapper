/**
 * Rule checks done in code, not by the LLM: explicit number ranges and decimal places.
 * Both sides are read the same way, and a mismatch becomes a scope note for the judge and the reviewer.
 */

export interface Limits {
  /** Largest whole number the text works with ("within 100" -> 100, "4-digit" -> 9999). */
  maxNumber?: number;
  /** Decimal places ("2 decimal places", "hundredths" -> 2). */
  decimals?: number;
}

const WORD_SCALE: Record<string, number> = { thousand: 1e3, million: 1e6, billion: 1e9 };
const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const DECIMAL_WORDS: Record<string, number> = { tenths: 1, tenth: 1, hundredths: 2, hundredth: 2, thousandths: 3, thousandth: 3 };

/** "1 000 000", "10,000", "100 thousand", "10 million" -> number. */
function readNumber(s: string): number | null {
  const m = /^(\d{1,3}(?:[ , ]\d{3})+|\d+)(?:\s+(thousand|million|billion))?/i.exec(s.trim());
  if (!m) return null;
  const n = Number(m[1]!.replace(/[ , ]/g, ''));
  return m[2] ? n * WORD_SCALE[m[2].toLowerCase()]! : n;
}

const NUM = String.raw`(\d{1,3}(?:[ , ]\d{3})+|\d+)(?:\s+(?:thousand|million|billion))?`;

export function extractLimits(text: string): Limits {
  const t = text.replace(/ /g, ' ');
  const out: Limits = {};
  const bump = (n: number | null) => {
    if (n !== null && n > 0 && (out.maxNumber === undefined || n > out.maxNumber)) out.maxNumber = n;
  };

  // within 100 / up to 1 000 000 / to 1000 / less than 20 / numbers to 10 million / beyond 1000 (not a cap)
  for (const m of t.matchAll(new RegExp(String.raw`\b(?:within|up to|upto|less than|not more than|to|till|until)\s+(${NUM})`, 'gi'))) {
    const n = readNumber(m[1]!);
    // "to 2 decimal places", "to 3 significant figures", "to the nearest 10" are not ranges
    const after = t.slice(m.index! + m[0].length, m.index! + m[0].length + 25).toLowerCase();
    if (/^\s*(decimal|d\.p|significant|s\.f|places|digit)/.test(after)) continue;
    if (/^\s*(cm|mm|m|km|kg|g|ml|l|min|minutes|h|hours|s|seconds|°|%)\b/.test(after)) continue;
    bump(n);
  }
  // 4-digit, 4- to 5-digit, 6-digit numbers, three-digit
  for (const m of t.matchAll(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)[- ]?(?:to\s+\d+-?\s*)?digit/gi)) {
    const range = /(\d+)-?\s*to\s+(\d+)-?\s*digit/i.exec(m[0]);
    const d = range ? Number(range[2]) : (WORD_NUM[m[1]!.toLowerCase()] ?? Number(m[1]));
    if (d > 0 && d < 16) bump(10 ** d - 1);
  }
  // "4- to 5-digit": the first pattern sees "4-" only; catch the upper bound explicitly
  for (const m of t.matchAll(/\b\d+-?\s*to\s+(\d+)-digit/gi)) bump(10 ** Number(m[1]) - 1);

  // decimal places
  for (const m of t.matchAll(/\b(\d+|one|two|three)\s+decimal places?\b/gi)) {
    const d = WORD_NUM[m[1]!.toLowerCase()] ?? Number(m[1]);
    if (out.decimals === undefined || d > out.decimals) out.decimals = d;
  }
  for (const m of t.matchAll(/\b(tenths?|hundredths?|thousandths?)\b/gi)) {
    const d = DECIMAL_WORDS[m[1]!.toLowerCase()]!;
    if (out.decimals === undefined || d > out.decimals) out.decimals = d;
  }
  return out;
}

/** Limits over several bullets: the widest range any of them reaches. */
export function mergeLimits(list: Limits[]): Limits {
  const out: Limits = {};
  for (const l of list) {
    if (l.maxNumber !== undefined && (out.maxNumber === undefined || l.maxNumber > out.maxNumber)) out.maxNumber = l.maxNumber;
    if (l.decimals !== undefined && (out.decimals === undefined || l.decimals > out.decimals)) out.decimals = l.decimals;
  }
  return out;
}

const fmt = (n: number) => n.toLocaleString('en-US').replace(/,/g, ' ');

/**
 * Scope notes when the curriculum and the product disagree on an explicit limit.
 * Only checked when both sides state the limit; silence on one side is not a mismatch.
 */
export function compareLimits(curriculum: Limits, product: Limits): string[] {
  const notes: string[] = [];
  if (curriculum.maxNumber !== undefined && product.maxNumber !== undefined) {
    if (product.maxNumber < curriculum.maxNumber) {
      notes.push(`Range: curriculum goes to ${fmt(curriculum.maxNumber)}, lesson only to ${fmt(product.maxNumber)}`);
    } else if (product.maxNumber >= curriculum.maxNumber * 10) {
      notes.push(`Range: lesson goes to ${fmt(product.maxNumber)}, beyond the curriculum's ${fmt(curriculum.maxNumber)}`);
    }
  }
  if (curriculum.decimals !== undefined && product.decimals !== undefined && curriculum.decimals !== product.decimals) {
    notes.push(`Decimals: curriculum ${curriculum.decimals} place${curriculum.decimals > 1 ? 's' : ''}, lesson ${product.decimals}`);
  }
  return notes;
}
