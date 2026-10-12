/** Text helpers shared by the parsers, the API and the web app. */

const QUOTES: Record<string, string> = { '‘': "'", '’': "'", '“': '"', '”': '"', '—': '-', '–': '-' };

/** Collapse whitespace (including NBSP and tabs) and trim. */
export function clean(s: unknown): string {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[\s ]+/g, ' ').trim();
}

/**
 * Normalised form used for stable IDs and text comparison: lower case, plain quotes,
 * no punctuation, no leading "to " (AU and PH write objectives as "To count…", PINE as "Count…").
 */
export function normText(s: unknown): string {
  let t = clean(s).toLowerCase().replace(/[‘’“”—–]/g, (c) => QUOTES[c] ?? c);
  t = t.replace(/[^a-z0-9₱$%<>=+×÷/.\-' ]+/g, ' ');
  t = t.replace(/[.,;:]+(\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
  return t.replace(/^to /, '');
}

/** A line that continues the previous objective rather than starting a new one. */
function isContinuation(line: string): boolean {
  if (/^(e\.?\s*g\.?|i\.?\s*e\.?)/i.test(line)) return true;
  if (/^[(\[]/.test(line)) return true;
  return !/^[A-Z]/.test(line);
}

/**
 * Split an objectives cell into individual objectives.
 * - Cells with `•` bullets: each bullet is one objective; non-bullet lines are wrapped text and are
 *   joined to the bullet before them (text before the first bullet becomes its own objective).
 * - Cells without bullets: one objective per line that starts with a capital letter (or "To"), with
 *   lower-case, digit, "(" and "e.g." lines joined to the line before.
 */
export function splitObjectives(cell: unknown): string[] {
  if (cell === null || cell === undefined) return [];
  const raw = String(cell).replace(/\r/g, '');
  const out: string[] = [];
  if (raw.includes('•')) {
    for (const part of raw.split('•')) {
      const t = clean(part);
      if (t) out.push(t);
    }
    return out;
  }
  for (const line of raw.split('\n')) {
    const t = clean(line);
    if (!t) continue;
    if (out.length && isContinuation(t)) out[out.length - 1] += ' ' + t;
    else out.push(t);
  }
  return out;
}

/** PH DepEd competency code: drop whitespace/NBSP and the `_x0002_` artefact (a lost hyphen). */
export function normPhCode(s: unknown): string {
  return String(s ?? '')
    .replace(/_x0002_/g, '-')
    .replace(/[\s ]+/g, '')
    .replace(/[.,;]+$/, '');
}

/** DepEd code shape: M<grade><strand>-<quarter roman><week letter(s)>-<number>[.<sub>][letter]. */
const PH_CODE = /M\d{1,2}[A-Z]{2}-[IVXivx]+[a-j]{1,2}-?\d+(?:\.\d+)?[a-z]?/g;

/**
 * Codes in a PH code cell. Cells may hold several codes joined by `/`, newlines or nothing, a code may be
 * broken across lines (`M5NS-IIa-\n106.1`), and code+text cells hold `M1NS-Ia-1.1: Visualizes…`.
 * Whitespace is removed first, then every code-shaped substring is taken.
 */
export function splitPhCodes(s: unknown): string[] {
  const flat = normPhCode(s);
  return [...new Set([...flat.matchAll(PH_CODE)].map((m) => m[0]))];
}

export function normAc9Code(s: unknown): string {
  return clean(s).toUpperCase();
}

/** Grade number implied by an AC9 code: AC9MFN01 -> 0, AC9M3N02 -> 3. */
export function ac9Year(code: string): number | null {
  const m = /^AC9M([F1-9]|10)/.exec(code);
  if (!m) return null;
  return m[1] === 'F' ? 0 : Number(m[1]);
}

/** Grade number implied by a PH code: M3NS-Ia-1.3 -> 3. */
export function phGrade(code: string): number | null {
  const m = /^M(\d+)/.exec(code);
  return m ? Number(m[1]) : null;
}

/** A chapter/unit/lesson label with a letter suffix (15A, 2A.1, 1.A) marks supplementary content. */
export function isLettered(code: string | null | undefined): boolean {
  return !!code && /[A-Za-z]/.test(code);
}
