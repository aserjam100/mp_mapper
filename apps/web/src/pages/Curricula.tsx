import { Link } from 'react-router-dom';
import { CoverageBar, Loading } from '../components/bits';
import { EDITION_NAMES, useCurricula, type Rating } from '../lib/api';

export function CurriculaPage() {
  const q = useCurricula();
  if (!q.data) return <Loading q={q} />;
  return (
    <>
      <h1>Curricula</h1>
      <p className="muted">
        Coverage per edition counts each objective once, by its best mapping. Ratings are Covered / Check / Not found; grey means no mapping yet.
      </p>
      <div className="grid cards">
        {q.data.map((c) => {
          const editions = [...new Set(c.coverage.map((x) => x.edition))].sort(
            (a, b) => Object.keys(EDITION_NAMES).indexOf(a) - Object.keys(EDITION_NAMES).indexOf(b),
          );
          const byStatus = (s: string) => c.mappings.filter((m) => m.status === s).reduce((n, m) => n + m.n, 0);
          return (
            <div key={c.id} className="card">
              <h2 style={{ marginTop: 0 }}>
                <Link to={`/curricula/${c.id}`}>{c.name}</Link>
              </h2>
              <div className="small muted">
                {c.code} · {c.country} · {c.version} · {c.publisher_owned ? 'publisher-mapped' : 'external'}
              </div>
              <div className="small muted">Source: {c.source_file}</div>
              <p>
                <b>{c.objectives}</b> objectives
                {c.stubs > 0 && (
                  <span className="muted">
                    {' '}
                    ({c.stubs} code-only stub{c.stubs > 1 ? 's' : ''}
                    {c.stubs === c.objectives ? ', text not yet imported' : ''})
                  </span>
                )}
                {' · '}
                mappings: <span className="s-approved">{byStatus('approved')} approved</span>,{' '}
                <span className="s-proposed">{byStatus('proposed')} proposed</span>
                {byStatus('rejected') > 0 && <>, <span className="s-rejected">{byStatus('rejected')} rejected</span></>}
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Edition</th>
                    <th style={{ width: '45%' }}>Best-match coverage</th>
                    <th>Covered</th>
                    <th>Check</th>
                    <th>Not found</th>
                    <th>No mapping</th>
                  </tr>
                </thead>
                <tbody>
                  {editions.map((e) => {
                    const rows = c.coverage.filter((x) => x.edition === e);
                    const n = (r: Rating) => rows.filter((x) => x.rating === r).reduce((s, x) => s + x.n, 0);
                    const counts = { covered: n('covered'), check: n('check'), not_found: n('not_found') };
                    const none = c.objectives - counts.covered - counts.check - counts.not_found;
                    return (
                      <tr key={e}>
                        <td>{EDITION_NAMES[e] ?? e}</td>
                        <td style={{ verticalAlign: 'middle' }}>
                          <CoverageBar counts={counts} total={c.objectives} />
                        </td>
                        <td>{counts.covered}</td>
                        <td>{counts.check}</td>
                        <td>{counts.not_found}</td>
                        <td className="muted">{none}</td>
                      </tr>
                    );
                  })}
                  {!editions.length && (
                    <tr>
                      <td colSpan={6} className="muted">
                        No mappings yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </>
  );
}
