import { useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loading, RatingPill, StatusText, Tags } from '../components/bits';
import { EDITION_NAMES, useEditionLocations, useEditions, useLocation, type BrowserLocation } from '../lib/api';

function groupTree(rows: BrowserLocation[]) {
  const chapters: { key: string; title: string; units: { key: string; title: string; items: BrowserLocation[] }[] }[] = [];
  for (const r of rows) {
    const chKey = `${r.book ?? ''}|${r.chapter_no ?? ''}|${r.chapter_title ?? ''}`;
    let ch = chapters.find((c) => c.key === chKey);
    if (!ch) {
      const prefix = r.edition_code === 'AU2' ? `${r.book} Topic ${r.chapter_no}` : r.chapter_no ? `Chapter ${r.chapter_no}` : '';
      ch = { key: chKey, title: [prefix, r.chapter_title].filter(Boolean).join(': ') || (r.optional ? 'Optional' : '—'), units: [] };
      chapters.push(ch);
    }
    const unKey = r.type === 'review' ? 'review' : `${r.unit_no ?? ''}|${r.unit_title ?? ''}`;
    let un = ch.units.find((u) => u.key === unKey);
    if (!un) {
      un = { key: unKey, title: r.type === 'review' ? '' : [r.unit_no && r.unit_no !== '0' ? `Unit ${r.unit_no}` : '', r.unit_title].filter(Boolean).join(': '), items: [] };
      ch.units.push(un);
    }
    un.items.push(r);
  }
  return chapters;
}

function shortLabel(r: BrowserLocation) {
  if (r.edition_code === 'PH_DPA') return `${r.external_id ?? r.activity_ref ?? ''} ${r.activity_title ?? r.lesson_title ?? ''}`;
  return [r.lesson_no, r.lesson_title, r.section === 'Hub' ? '(Hub)' : ''].filter(Boolean).join(' ');
}

function LocationPanel({ id }: { id: string }) {
  const q = useLocation(id);
  if (!q.data) return <Loading q={q} />;
  const { location: l, objectives, sharedWith, mappings } = q.data;
  const byCurriculum = Object.entries(mappings.reduce<Record<string, typeof mappings>>((a, m) => ((a[m.curriculum_code] ??= []).push(m), a), {}));
  return (
    <div className="card">
      <div className="small muted">{EDITION_NAMES[l.edition_code]}</div>
      <h2 style={{ marginTop: 2 }}>{l.label}</h2>
      <div>
        <Tags type={l.type} optional={l.optional} supplement={l.supplement} reuse={l.reuse_quality} />
      </div>
      <div className="kv small" style={{ marginTop: 8 }}>
        {l.chapter_title && (
          <>
            <span className="muted">Chapter / topic</span>
            <span>
              {l.chapter_no} {l.chapter_title}
            </span>
          </>
        )}
        {l.unit_title && (
          <>
            <span className="muted">Unit</span>
            <span>
              {l.unit_no} {l.unit_title}
            </span>
          </>
        )}
        {l.lesson_title && (
          <>
            <span className="muted">Lesson</span>
            <span>
              {l.lesson_no} {l.lesson_title}
            </span>
          </>
        )}
        {l.activity_ref && (
          <>
            <span className="muted">Activity ref</span>
            <span className="mono">{l.activity_ref}</span>
          </>
        )}
        <span className="muted">Source</span>
        <span>
          {l.source_file} › {l.source_sheet} row {l.source_row}
        </span>
      </div>

      <h3>Objectives</h3>
      {objectives.length === 0 && <div className="muted small">No objectives listed for this location.</div>}
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {objectives.map((o) => (
          <li key={o.id}>
            {o.text}
            {o.link === 'reworded_of' && <span className="tag">PH wording</span>}
            {o.origin_edition !== l.edition_code && <span className="tag">from {EDITION_NAMES[o.origin_edition]}</span>}
          </li>
        ))}
      </ul>

      {sharedWith.length > 0 && (
        <>
          <h3>Same content elsewhere</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }} className="small">
            {sharedWith.map((s) => (
              <li key={s.location_id}>
                <Link to={`/products?edition=${s.edition_code}&grade=${s.grade_num}&loc=${s.location_id}`}>
                  {EDITION_NAMES[s.edition_code]} · {s.label}
                </Link>
                <Tags type={s.type} optional={s.optional} reuse={s.reuse_quality} />
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>Curriculum objectives mapped to this content</h3>
      {byCurriculum.length === 0 && <div className="muted small">None yet.</div>}
      {byCurriculum.map(([cur, ms]) => (
        <div key={cur}>
          <div className="small" style={{ fontWeight: 600, marginTop: 8 }}>
            {cur} <span className="muted">({ms.length})</span>
          </div>
          <table>
            <tbody>
              {ms.map((m) => (
                <tr key={m.mapping_id}>
                  <td style={{ width: 110 }}>
                    <Link className="mono" to={`/objectives/${m.objective_id}`}>
                      {m.code}
                    </Link>
                  </td>
                  <td className="small">
                    {m.text}
                    {!m.direct && (
                      <div className="muted">
                        via {EDITION_NAMES[m.edition_code]} {m.label}
                      </div>
                    )}
                    {m.product_objective_text && <div className="muted">↳ “{m.product_objective_text}”</div>}
                  </td>
                  <td style={{ width: 150 }}>
                    <RatingPill rating={m.rating} /> <StatusText status={m.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export function ProductsPage() {
  const editions = useEditions();
  const [params, setParams] = useSearchParams();
  const edition = params.get('edition') ?? 'PINE';
  const grade = Number(params.get('grade') ?? 1);
  const loc = params.get('loc');
  const q = useEditionLocations(edition, grade);
  const tree = useMemo(() => groupTree(q.data ?? []), [q.data]);
  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v === null ? p.delete(k) : p.set(k, v);
    setParams(p);
  };
  const selRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    selRef.current?.scrollIntoView({ block: 'nearest' });
  }, [q.data, loc]);

  return (
    <>
      <h1>Product browser</h1>
      <div className="filters">
        {(editions.data ?? []).map((e) => (
          <button key={e.code} onClick={() => set({ edition: e.code, loc: null })} style={e.code === edition ? { fontWeight: 700, borderColor: 'var(--accent)' } : {}}>
            {EDITION_NAMES[e.code]} <span className="count">{e.locations}</span>
          </button>
        ))}
        <select value={grade} onChange={(e) => set({ grade: e.target.value, loc: null })}>
          {[1, 2, 3, 4, 5, 6].map((g) => (
            <option key={g} value={g}>
              {edition === 'AU2' ? 'Year' : 'Grade'} {g}
            </option>
          ))}
        </select>
        <span className="small muted">Counts beside a lesson = curriculum objectives mapped to its content (all editions).</span>
      </div>
      <div className="split">
        <div className="card tree">
          <Loading q={q} />
          {tree.map((ch) => (
            <div key={ch.key}>
              <div className="ch">{ch.title}</div>
              {ch.units.map((u) => (
                <div key={u.key}>
                  {u.title && <div className="un">{u.title}</div>}
                  {u.items.map((r) => (
                    <a
                      key={r.location_id}
                      ref={r.location_id === loc ? selRef : undefined}
                      className={`ls${r.location_id === loc ? ' sel' : ''}`}
                      onClick={() => set({ loc: r.location_id })}
                      style={r.parent_location_id ? { paddingLeft: 34 } : undefined}
                    >
                      {shortLabel(r)}
                      {r.mapped.map((m) => (
                        <span key={m.curriculum} className="count">
                          {m.curriculum.split('-')[0]}:{m.n}
                        </span>
                      ))}
                      <Tags type={r.type === 'teaching' ? undefined : r.type} optional={r.optional} supplement={r.supplement} />
                    </a>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="sticky-panel">{loc ? <LocationPanel id={loc} /> : <div className="card empty">Select a lesson or activity.</div>}</div>
      </div>
    </>
  );
}
