/**
 * Grade number from a grade label in an uploaded curriculum: "Grade 3", "P3", "Year 3", "Primary 3", "3" -> 3;
 * "Foundation", "F", "K", "Kinder", "Prep", "Reception" -> 0. Returns null when no grade can be read.
 */
export function parseGrade(label: unknown): number | null {
  const s = String(label ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^(f|k|kg|foundation|kinder(garten)?|prep|reception)\b/.test(s)) return 0;
  const m = /(?:^|[^a-z0-9])(?:grade|year|yr|primary|p|g|y|class|std|standard)?\s*-?\s*(\d{1,2})\b/.exec(s);
  if (m) return Number(m[1]);
  return null;
}
