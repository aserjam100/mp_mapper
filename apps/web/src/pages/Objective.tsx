import { Link, useParams } from 'react-router-dom';
import { Loading, RatingPill, StatusText, Tags } from '../components/bits';
import { EDITION_NAMES, useObjective, type ObjectiveMapping } from '../lib/api';

function MappingCard({ m }: { m: ObjectiveMapping }) {
  return (
    <div className={`mapping${m.isBest ? ' best' : ''}`}>
      <div className="head">
        <RatingPill rating={m.rating} />
        <StatusText status={m.status} />
        {m.isBest && <span className="tag" style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}>best match</span>}
        {m.role === 'related' && <span className="tag">related only</span>}
        <Link to={`/products?edition=${m.edition_code}&grade=${m.grade_num}&loc=${m.location_id}`}>{m.label}</Link>
        <Tags type={m.type} optional={m.optional} supplement={m.supplement} reuse={m.reuse_quality} />
      </div>
      <div style={{ marginTop: 6 }}>
        {m.product_objective_text ? (
          <>“{m.product_objective_text}”</>
        ) : (
          <span className="muted">Whole-lesson mapping (the source ties this code to the lesson, not a bullet)</span>
        )}
      </div>
      {m.scope_note && (
        <div className="small" style={{ marginTop: 4 }}>
          <b>Scope:</b> {m.scope_note}
        </div>
      )}
      {m.related_note && (
        <div className="small" style={{ marginTop: 4 }}>
          <b>Related only:</b> {m.related_note}
        </div>
      )}
      {m.alsoDeliveredIn.length > 0 && (
        <div className="small muted" style={{ marginTop: 4 }}>
          Same content also delivered in:{' '}
          {m.alsoDeliveredIn.map((s, i) => (
            <span key={s.location_id}>
              {i > 0 && '; '}
              <Link to={`/products?edition=${s.edition_code}&grade=${s.grade_num}&loc=${s.location_id}`}>
                {EDITION_NAMES[s.edition_code]} {s.label}
              </Link>
            </span>
          ))}
        </div>
      )}
      <details style={{ marginTop: 6 }}>
        <summary>
          History ({m.history.length} version{m.history.length > 1 ? 's' : ''}) · source {m.source_file} › {m.source_sheet} row {m.source_row}
        </summary>
        <table style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th>v</th>
              <th>When</th>
              <th>Who</th>
              <th>Source</th>
              <th>Rating</th>
              <th>Status</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {m.history.map((h) => (
              <tr key={h.id}>
                <td>{h.version}</td>
                <td className="small">{new Date(h.created_at).toLocaleString()}</td>
                <td className="small">{h.actor}</td>
                <td className="small">{h.source}</td>
                <td>
                  <RatingPill rating={h.rating} />
                </td>
                <td>
                  <StatusText status={h.status} />
                </td>
                <td className="small">{h.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

export function ObjectivePage() {
  const { id = '' } = useParams();
  const q = useObjective(id);
  if (!q.data) return <Loading q={q} />;
  const { objective: o, editions, related } = q.data;
  const relatedByCurriculum = Object.entries(
    related.reduce<Record<string, typeof related>>((acc, r) => ((acc[r.curriculum_code] ??= []).push(r), acc), {}),
  );

  return (
    <>
      <div className="small">
        <Link to="/">Curricula</Link> › <Link to={`/curricula/${o.curriculum_id}`}>{o.curriculum_name}</Link> ›
      </div>
      <h1>
        <span className="mono" style={{ fontSize: 16 }}>{o.code}</span> {o.text}
      </h1>
      <div className="muted">
        {[o.grade_label, o.track, o.strand, o.sub_strand, o.topic].filter(Boolean).join(' · ')}
        {o.objective_no && <> · objective {o.objective_no}</>}
      </div>

      <div className="split" style={{ gridTemplateColumns: '1fr minmax(300px, 420px)', marginTop: 16 }}>
        <div>
          {editions.length === 0 && <div className="card empty">No mappings for this objective yet.</div>}
          {editions.map((g) => (
            <section key={g.edition}>
              <h2>
                {EDITION_NAMES[g.edition] ?? g.edition} <span className="muted small">{g.mappings.length} location{g.mappings.length > 1 ? 's' : ''}</span>
              </h2>
              {g.mappings.map((m) => (
                <MappingCard key={m.mapping_id} m={m} />
              ))}
            </section>
          ))}
        </div>
        <aside className="card sticky-panel">
          <h3 style={{ marginTop: 0 }}>Approved mappings from other curricula on the same content</h3>
          <p className="small muted">Publisher-approved codes attached to the lessons and activities listed on the left (including PH activities that reuse PINE lessons).</p>
          {relatedByCurriculum.length === 0 && <div className="muted small">None.</div>}
          {relatedByCurriculum.map(([cur, rows]) => (
            <div key={cur}>
              <h3>{cur}</h3>
              {rows.map((r) => (
                <div key={`${r.objective_id}-${r.location_id}`} className="small" style={{ marginBottom: 6 }}>
                  <Link to={`/objectives/${r.objective_id}`} className="mono">
                    {r.code}
                  </Link>{' '}
                  {r.text.startsWith(r.code ?? '') ? '' : r.text}
                  <div className="muted">
                    via {EDITION_NAMES[r.edition_code]} {r.label}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </aside>
      </div>
    </>
  );
}
