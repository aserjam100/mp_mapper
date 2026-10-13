import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loading } from '../components/bits';
import { EDITION_NAMES, send, useCurricula, useMatchingStatus, useRuns, type RunRow } from '../lib/api';

const STATUS_LABEL: Record<RunRow['status'], string> = {
  retrieving: 'Finding candidates…',
  ready: 'Ready for AI check',
  judging: 'AI check running…',
  finishing: 'Saving…',
  done: 'Done',
  failed: 'Failed',
};

export function RunStatusText({ run }: { run: Pick<RunRow, 'status' | 'progress'> }) {
  const p = run.progress;
  const busy = run.status === 'retrieving' || run.status === 'judging';
  return (
    <span className={run.status === 'failed' ? 's-rejected' : run.status === 'done' ? 's-approved' : undefined}>
      {STATUS_LABEL[run.status]}
      {busy && p.total ? ` ${p.done ?? 0} / ${p.total}` : ''}
    </span>
  );
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '–');

export function RunsPage() {
  const runs = useRuns();
  const curricula = useCurricula();
  const status = useMatchingStatus();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    curriculumId: params.get('curriculum') ?? '',
    mode: 'propose' as 'propose' | 'accuracy',
    editions: ['PINE', 'AU2', 'PH_DPA'],
    gradeWindow: 1,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const usable = (curricula.data ?? []).filter((c) => c.objectives > c.stubs);
  const chosen = usable.find((c) => c.id === form.curriculumId);
  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const { id } = await send<{ id: string }>('POST', '/runs', form);
      await qc.invalidateQueries({ queryKey: ['runs'] });
      nav(`/runs/${id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (e: string) =>
    setForm((f) => ({ ...f, editions: f.editions.includes(e) ? f.editions.filter((x) => x !== e) : [...f.editions, e].sort((a, b) => Object.keys(EDITION_NAMES).indexOf(a) - Object.keys(EDITION_NAMES).indexOf(b)) }));

  const s = status.data;
  return (
    <>
      <h1>Matching runs</h1>
      <p className="muted">A run finds candidate lessons for every objective, then (if you choose) asks the AI to pick the best one and rate it.</p>

      {s && (
        <p className="small">
          Search: <b>{s.embedding.label}</b>
          {s.embedding.ollama === false && <span className="s-rejected"> · Ollama is not running (start it with “ollama serve”)</span>}
          {' · '}AI check: <b>{s.judge.model}</b>
          {!s.judge.hasKey && <span className="s-rejected"> · no ANTHROPIC_API_KEY in .env</span>}
          {' · '}
          {s.consent ? <span className="muted">sending product text to Anthropic approved {s.consent.at.slice(0, 10)}</span> : <span className="muted">not yet approved to send product text to Anthropic</span>}
        </p>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Start a run</h3>
        <div className="filters">
          <select value={form.curriculumId} onChange={(e) => setForm({ ...form, curriculumId: e.target.value })}>
            <option value="">Choose a curriculum…</option>
            {usable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.objectives - c.stubs} objectives)
              </option>
            ))}
          </select>
          <label>
            <input type="radio" checked={form.mode === 'propose'} onChange={() => setForm({ ...form, mode: 'propose' })} /> Propose mappings
          </label>
          <label title="Hides this curriculum's approved mappings and scores the matcher against them. Writes no mappings.">
            <input type="radio" checked={form.mode === 'accuracy'} onChange={() => setForm({ ...form, mode: 'accuracy' })} /> Accuracy test
          </label>
        </div>
        <div className="filters">
          Editions:
          {Object.entries(EDITION_NAMES).map(([code, name]) => (
            <label key={code}>
              <input type="checkbox" checked={form.editions.includes(code)} onChange={() => toggle(code)} /> {name}
            </label>
          ))}
          <label>
            Grades either side{' '}
            <select value={form.gradeWindow} onChange={(e) => setForm({ ...form, gradeWindow: Number(e.target.value) })}>
              {[0, 1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  ±{n}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" onClick={start} disabled={busy || !form.curriculumId || !form.editions.length}>
            Find candidates
          </button>
        </div>
        {chosen && form.mode === 'accuracy' && chosen.mappings.every((m) => m.status !== 'approved') && (
          <p className="small s-rejected">This curriculum has no approved mappings, so there is nothing to score against.</p>
        )}
        <p className="small muted">This step runs locally and costs nothing. You'll see the AI check's cost before it starts.</p>
        {error && <p className="s-rejected">{error}</p>}
      </div>

      <h2>Runs</h2>
      {!runs.data ? (
        <Loading q={runs} />
      ) : !runs.data.length ? (
        <div className="empty">No runs yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Started</th>
              <th>Curriculum</th>
              <th>Type</th>
              <th>Editions</th>
              <th>Status</th>
              <th>AI cost</th>
              <th>Accuracy (best match / top 3)</th>
            </tr>
          </thead>
          <tbody>
            {runs.data.map((r) => {
              const t = (r as unknown as { accuracy_total: { objectives: number; bestFound: number; top3: number } | null }).accuracy_total;
              return (
                <tr key={r.id}>
                  <td>
                    <Link to={`/runs/${r.id}`}>{new Date(r.started_at).toLocaleString()}</Link>
                  </td>
                  <td>{r.curriculum_name}</td>
                  <td>{r.mode === 'accuracy' ? 'Accuracy test' : 'Proposals'}</td>
                  <td>{r.params.editions.map((e) => EDITION_NAMES[e] ?? e).join(', ')}</td>
                  <td>
                    <RunStatusText run={r} />
                  </td>
                  <td>{r.actual_cost ? `$${Number(r.actual_cost).toFixed(2)}` : r.status === 'ready' && r.est_cost ? <span className="muted">est. ${Number(r.est_cost).toFixed(2)}</span> : '–'}</td>
                  <td>{t ? `${pct(t.bestFound, t.objectives)} / ${pct(t.top3, t.objectives)}` : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
