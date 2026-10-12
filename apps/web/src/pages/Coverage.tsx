import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Loading, RatingPill, StatusText, Tags } from '../components/bits';
import { EDITION_NAMES, useCoverage } from '../lib/api';

const FILTERS = ['grade', 'track', 'strand', 'edition', 'rating', 'status', 'q'] as const;

export function CoveragePage() {
  const { id = '' } = useParams();
  const q = useCoverage(id);
  const [params, setParams] = useSearchParams();
  const f = Object.fromEntries(FILTERS.map((k) => [k, params.get(k) ?? ''])) as Record<(typeof FILTERS)[number], string>;
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };

  const data = q.data;
  const options = useMemo(() => {
    const os = data?.objectives ?? [];
    const uniq = (xs: (string | null)[]) => [...new Set(xs.filter(Boolean) as string[])];
    return { grade: uniq(os.map((o) => o.grade_label)), track: uniq(os.map((o) => o.track)), strand: uniq(os.map((o) => o.strand)) };
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    const eds = f.edition ? [f.edition] : data.editions;
    const needle = f.q.toLowerCase();
    return data.objectives.filter((o) => {
      if (f.grade && o.grade_label !== f.grade) return false;
      if (f.track && o.track !== f.track) return false;
      if (f.strand && o.strand !== f.strand) return false;
      if (needle && !`${o.code} ${o.text} ${o.topic ?? ''} ${o.sub_strand ?? ''}`.toLowerCase().includes(needle)) return false;
      if (f.rating) {
        const match = eds.some((e) => (f.rating === 'none' ? !o.cells[e] : o.cells[e]?.rating === f.rating));
        if (!match) return false;
      }
      if (f.status && !eds.some((e) => o.cells[e]?.status === f.status)) return false;
      return true;
    });
  }, [data, f.grade, f.track, f.strand, f.edition, f.rating, f.status, f.q]);

  if (!data) return <Loading q={q} />;
  const editions = f.edition ? [f.edition] : data.editions;

  return (
    <>
      <div className="small">
        <Link to="/">Curricula</Link> ›
      </div>
      <h1>{data.curriculum.name}</h1>
      <div className="filters">
        <input type="search" placeholder="Search code or text" value={f.q} onChange={(e) => set('q', e.target.value)} />
        <select value={f.grade} onChange={(e) => set('grade', e.target.value)}>
          <option value="">All grades</option>
          {options.grade.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
        {options.track.length > 0 && (
          <select value={f.track} onChange={(e) => set('track', e.target.value)}>
            <option value="">All tracks</option>
            {options.track.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        )}
        <select value={f.strand} onChange={(e) => set('strand', e.target.value)}>
          <option value="">All strands</option>
          {options.strand.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
        <select value={f.edition} onChange={(e) => set('edition', e.target.value)}>
          <option value="">All editions</option>
          {data.editions.map((e) => (
            <option key={e} value={e}>
              {EDITION_NAMES[e] ?? e}
            </option>
          ))}
        </select>
        <select value={f.rating} onChange={(e) => set('rating', e.target.value)}>
          <option value="">Any rating</option>
          <option value="covered">Covered</option>
          <option value="check">Check</option>
          <option value="not_found">Not found</option>
          <option value="none">No mapping</option>
        </select>
        <select value={f.status} onChange={(e) => set('status', e.target.value)}>
          <option value="">Any status</option>
          <option value="proposed">Proposed</option>
          <option value="approved">Approved</option>
        </select>
        {FILTERS.some((k) => f[k]) && <button onClick={() => setParams({}, { replace: true })}>Clear</button>}
        <span className="muted small">
          {rows.length} of {data.objectives.length} objectives
        </span>
      </div>
      <table>
        <thead>
          <tr>
            <th style={{ width: 90 }}>Code</th>
            <th style={{ width: 80 }}>Grade</th>
            <th>Objective</th>
            {editions.map((e) => (
              <th key={e}>{EDITION_NAMES[e] ?? e} — best match</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id}>
              <td className="mono">
                <Link to={`/objectives/${o.id}`}>{o.code}</Link>
              </td>
              <td className="small">
                {o.grade_label}
                {o.track && o.track !== 'Standard' && <div className="muted">{o.track}</div>}
              </td>
              <td>
                <Link to={`/objectives/${o.id}`} style={{ color: 'inherit' }}>
                  {o.text}
                </Link>
                <div className="small muted">{[o.strand, o.sub_strand, o.topic].filter(Boolean).join(' › ')}</div>
              </td>
              {editions.map((e) => {
                const c = o.cells[e];
                return (
                  <td key={e}>
                    {c ? (
                      <div className={`cell r-${c.rating}`} title={c.scopeNote ?? c.relatedNote ?? ''}>
                        <RatingPill rating={c.rating} /> <StatusText status={c.status} />
                        {c.candidates > 1 && <span className="count">+{c.candidates - 1} alt</span>}
                        <span className="loc">
                          {c.location}
                          <Tags type={c.type} optional={c.optional} supplement={c.supplement} />
                        </span>
                      </div>
                    ) : (
                      <span className="pill r-none">No mapping</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <div className="empty">No objectives match these filters.</div>}
    </>
  );
}
