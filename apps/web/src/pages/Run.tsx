import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loading, RatingPill } from '../components/bits';
import { EDITION_NAMES, send, useRun, useRunResults, type AccuracyReport, type RunDetail, type Tally } from '../lib/api';
import { RunStatusText } from './Runs';

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '–');

function AccuracyTable({ title, rows, judged }: { title: string; rows: [string, Tally][]; judged: boolean }) {
  return (
    <>
      <h3>{title}</h3>
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Objectives</th>
            <th>Best match found</th>
            <th>In top 3</th>
            <th>In candidate list</th>
            {judged && <th>Rating agrees</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, t]) => (
            <tr key={k}>
              <td>{k}</td>
              <td>{t.objectives}</td>
              <td>{pct(t.bestFound, t.objectives)}</td>
              <td>{pct(t.top3, t.objectives)}</td>
              <td>{pct(t.anywhere, t.objectives)}</td>
              {judged && <td>{pct(t.ratingAgree, t.rated)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Accuracy({ a, runId }: { a: AccuracyReport; runId: string }) {
  const ratings = ['covered', 'check', 'not_found'] as const;
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h2 style={{ marginTop: 0 }}>Accuracy</h2>
      <p className="small muted">
        Scored against this curriculum’s approved mappings, which the matcher did not see. “Best match found” means the chosen lesson is an approved one.
        {!a.judged && ' Without the AI check, the top search result is the choice and ratings are not scored.'}{' '}
        <a href={`/api/runs/${runId}/accuracy.md`}>Download report</a>
      </p>
      <AccuracyTable title="Overall" rows={[['All', a.total]]} judged={a.judged} />
      {a.judged && (
        <>
          <h3>Ratings: expected vs AI</h3>
          <table style={{ width: 'auto' }}>
            <thead>
              <tr>
                <th>Expected</th>
                <th>Covered</th>
                <th>Check</th>
                <th>Not found</th>
              </tr>
            </thead>
            <tbody>
              {(['covered', 'not_found'] as const).map((e) => (
                <tr key={e}>
                  <td>
                    <RatingPill rating={e} />
                  </td>
                  {ratings.map((r) => (
                    <td key={r}>{a.confusion[e]?.[r] ?? 0}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <AccuracyTable title="By grade" rows={Object.entries(a.byGrade)} judged={a.judged} />
      <AccuracyTable title="By strand" rows={Object.entries(a.byStrand).sort((x, y) => y[1].objectives - x[1].objectives)} judged={a.judged} />
    </div>
  );
}

function Actions({ d }: { d: RunDetail }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const est = d.run.report.estimate;
  const refresh = () => qc.invalidateQueries({ queryKey: ['run', d.run.id] });
  const call = async (path: string, body?: unknown) => {
    setError('');
    try {
      await send('POST', path, body);
      setAsking(false);
      await refresh();
    } catch (e) {
      const err = e as Error & { data?: { needsConsent?: boolean } };
      if (err.data?.needsConsent) setAsking(true);
      else setError(err.message);
    }
  };
  if (d.run.status !== 'ready') return null;
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3 style={{ marginTop: 0 }}>Next: AI check</h3>
      {est && (
        <p>
          {est.calls} objectives to check{est.cachedCalls ? ` (${est.cachedCalls} already checked before, free)` : ''}. Estimated cost <b>${est.usdRemaining.toFixed(2)}</b> with{' '}
          {est.model}.
        </p>
      )}
      {!d.hasKey && <p className="s-rejected">Add ANTHROPIC_API_KEY to .env and restart the app to use the AI check.</p>}
      {asking && (
        <div className="card" style={{ background: 'var(--check-bg)', borderColor: 'var(--check)' }}>
          <b>This sends product content to Anthropic for the first time.</b>
          <p>
            The AI check sends each curriculum objective with the text of its candidate lessons (titles and lesson objectives) to the Anthropic API. Nothing is
            sent until you agree. You'll only be asked once.
          </p>
          <button className="primary" onClick={() => call(`/runs/${d.run.id}/judge`, { consent: true })}>
            I agree, start the AI check
          </button>{' '}
          <button onClick={() => setAsking(false)}>Cancel</button>
        </div>
      )}
      {!asking && (
        <p>
          <button className="primary" disabled={!d.hasKey} onClick={() => call(`/runs/${d.run.id}/judge`, { consent: false })}>
            Start AI check
          </button>{' '}
          <button onClick={() => call(`/runs/${d.run.id}/finish`)}>Finish without AI check</button>
        </p>
      )}
      <p className="small muted">Without the AI check, the top search result is used and rated Check.</p>
      {error && <p className="s-rejected">{error}</p>}
    </div>
  );
}

export function RunPage() {
  const { id = '' } = useParams();
  const q = useRun(id);
  const d = q.data;
  const showResults = !!d && ['ready', 'done'].includes(d.run.status);
  const results = useRunResults(id, showResults);
  const [filter, setFilter] = useState({ grade: '', rating: '', q: '' });

  const rows = useMemo(() => {
    const needle = filter.q.toLowerCase();
    return (results.data ?? []).filter(
      (o) =>
        (!filter.grade || o.grade_label === filter.grade) &&
        (!filter.rating || Object.values(o.cells).some((c) => (filter.rating === 'scope' ? c.chosen?.scopeNotes.length : (c.rating ?? 'unjudged') === filter.rating))) &&
        (!needle || `${o.code} ${o.text}`.toLowerCase().includes(needle)),
    );
  }, [results.data, filter]);

  if (!d) return <Loading q={q} />;
  const r = d.run;
  const editions = r.params.editions;
  const grades = [...new Set((results.data ?? []).map((o) => o.grade_label))];

  return (
    <>
      <div className="small">
        <Link to="/runs">Runs</Link> ›
      </div>
      <h1>
        {r.mode === 'accuracy' ? 'Accuracy test' : 'Matching run'}: {r.curriculum_name}
      </h1>
      <p className="small muted">
        {new Date(r.started_at).toLocaleString()} · {editions.map((e) => EDITION_NAMES[e] ?? e).join(', ')} · grades ±{r.params.gradeWindow} · search {r.embed_model}
        {r.report.judged && ` · AI check ${r.llm_model}`}
      </p>
      <p>
        <RunStatusText run={r} />
        {r.status === 'judging' && r.progress.usd !== undefined && <span className="muted"> · ${r.progress.usd.toFixed(2)} so far</span>}
        {r.status === 'done' && r.actual_cost && <span className="muted"> · AI cost ${Number(r.actual_cost).toFixed(2)}</span>}
        {r.report.errors ? <span className="s-rejected"> · {r.report.errors} objectives failed the AI check</span> : null}
      </p>
      {r.error && <p className="s-rejected">{r.error}</p>}
      {r.status === 'done' && r.mode === 'propose' && r.report.written && (
        <p>
          Proposed mappings: {r.report.written.written ?? 0} new or updated
          {r.report.written.keptExisting ? `, ${r.report.written.keptExisting} left alone (already imported or reviewed)` : ''}
          {r.report.written.superseded ? `, ${r.report.written.superseded} older proposals replaced` : ''}.{' '}
          <Link to={`/curricula/${r.curriculum_id}`}>Open coverage</Link>
        </p>
      )}

      <Actions d={d} />
      {r.report.accuracy && <Accuracy a={r.report.accuracy} runId={r.id} />}

      {showResults && (
        <>
          <h2>Results</h2>
          <div className="filters">
            <input type="search" placeholder="Search code or text" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
            <select value={filter.grade} onChange={(e) => setFilter({ ...filter, grade: e.target.value })}>
              <option value="">All grades</option>
              {grades.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
            <select value={filter.rating} onChange={(e) => setFilter({ ...filter, rating: e.target.value })}>
              <option value="">Any rating</option>
              <option value="covered">Covered</option>
              <option value="check">Check</option>
              <option value="not_found">Not found</option>
              <option value="unjudged">Not AI-checked</option>
              <option value="scope">Has a scope note</option>
            </select>
            <span className="small muted">{rows.length} objectives</span>
          </div>
          {!results.data ? (
            <Loading q={results} />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Objective</th>
                  {editions.map((e) => (
                    <th key={e}>{EDITION_NAMES[e] ?? e}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 400).map((o) => (
                  <tr key={o.id}>
                    <td style={{ maxWidth: 420 }}>
                      <Link to={`/objectives/${o.id}`} className="mono">
                        {o.code ?? 'objective'}
                      </Link>{' '}
                      <span className="small muted">{o.grade_label}</span>
                      <div>{o.text}</div>
                    </td>
                    {editions.map((e) => {
                      const c = o.cells[e];
                      if (!c) return <td key={e} />;
                      return (
                        <td key={e} style={{ minWidth: 240 }}>
                          <div className={`cell r-${c.rating ?? 'none'}`}>
                            {c.judged ? <RatingPill rating={c.rating} /> : <span className="pill r-none">Not AI-checked</span>}
                            {c.chosen?.reuse && <span className="tag" title="Approved for a near-identical objective in another curriculum">reused</span>}
                            <span className="loc">{c.chosen?.label ?? <span className="muted">no lesson</span>}</span>
                            {c.note && <div className="small">{c.note}</div>}
                            {c.chosen?.scopeNotes.map((n) => (
                              <div key={n} className="small" style={{ color: 'var(--check)' }}>
                                {n}
                              </div>
                            ))}
                            {c.error && <div className="small s-rejected">{c.error}</div>}
                            {c.candidates.length > 1 && (
                              <details>
                                <summary>{c.candidates.length - 1} other candidates</summary>
                                <ol className="small" style={{ paddingLeft: 18, margin: '4px 0' }}>
                                  {c.candidates
                                    .filter((x) => x.locationId !== c.chosen?.locationId)
                                    .map((x) => (
                                      <li key={x.key}>
                                        {x.label}
                                        {x.judge === 'alternative' && <span className="tag">AI alternative</span>}
                                        {x.sources.includes('reuse') && <span className="tag">reused</span>}
                                      </li>
                                    ))}
                                </ol>
                              </details>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {rows.length > 400 && <p className="small muted">Showing the first 400. Use the filters to narrow down.</p>}
        </>
      )}
    </>
  );
}
