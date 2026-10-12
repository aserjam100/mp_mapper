import type { Rating, Status } from '../lib/api';

const RATING_LABEL: Record<Rating, string> = { covered: 'Covered', check: 'Check', not_found: 'Not found' };

export function RatingPill({ rating }: { rating: Rating | null | undefined }) {
  if (!rating) return <span className="pill r-none">No mapping</span>;
  return <span className={`pill r-${rating}`}>{RATING_LABEL[rating]}</span>;
}

export function StatusText({ status }: { status: Status }) {
  return <span className={`small s-${status}`}>{status}</span>;
}

export function Tags({ type, optional, supplement, reuse }: { type?: string; optional?: boolean; supplement?: boolean; reuse?: string | null }) {
  return (
    <>
      {type && type !== 'teaching' && <span className="tag">{type.replace('_', ' ')}</span>}
      {optional && <span className="tag">optional</span>}
      {supplement && <span className="tag">supplement</span>}
      {reuse && <span className="tag" title="PH reuse of PINE content (colour legend)">reuse: {reuse.replace('_', ' ')}</span>}
    </>
  );
}

/** Stacked bar of covered / check / not found out of `total` objectives. */
export function CoverageBar({ counts, total }: { counts: Partial<Record<Rating, number>>; total: number }) {
  const pct = (n = 0) => `${total ? (100 * n) / total : 0}%`;
  return (
    <div className="bar" title={`Covered ${counts.covered ?? 0} · Check ${counts.check ?? 0} · Not found ${counts.not_found ?? 0} · No mapping ${total - (counts.covered ?? 0) - (counts.check ?? 0) - (counts.not_found ?? 0)}`}>
      <span className="covered" style={{ width: pct(counts.covered) }} />
      <span className="check" style={{ width: pct(counts.check) }} />
      <span className="not_found" style={{ width: pct(counts.not_found) }} />
    </div>
  );
}

export function Loading({ q }: { q: { isLoading: boolean; error: unknown } }) {
  if (q.isLoading) return <div className="empty">Loading…</div>;
  if (q.error) return <div className="empty">Error: {String((q.error as Error).message)}</div>;
  return null;
}
