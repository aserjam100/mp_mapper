import { normText } from './text.js';

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = ` ${s} `;
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice similarity over character bigrams of the normalised texts (0..1). */
export function textSimilarity(a: string, b: string): number {
  const x = normText(a);
  const y = normText(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const A = bigrams(x);
  const B = bigrams(y);
  let inter = 0;
  let total = 0;
  for (const [g, n] of A) {
    inter += Math.min(n, B.get(g) ?? 0);
    total += n;
  }
  for (const n of B.values()) total += n;
  return (2 * inter) / total;
}

/** Best match of `text` among `candidates`, or null if none reaches `min`. */
export function bestMatch(text: string, candidates: string[], min: number): { index: number; score: number } | null {
  let best: { index: number; score: number } | null = null;
  candidates.forEach((c, index) => {
    const score = textSimilarity(text, c);
    if (!best || score > best.score) best = { index, score };
  });
  return best && (best as { score: number }).score >= min ? best : null;
}
