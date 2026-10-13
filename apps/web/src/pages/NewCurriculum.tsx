import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { send, type ColumnMap, type UploadPreview, type UploadResult } from '../lib/api';

const FIELDS: { key: keyof ColumnMap; label: string; required?: boolean; guess: RegExp }[] = [
  { key: 'grade', label: 'Grade', required: true, guess: /grade|year|level|class|primary|stage/i },
  { key: 'strand', label: 'Strand', guess: /^strand|domain|area/i },
  { key: 'subStrand', label: 'Sub-strand', guess: /sub.?strand|topic|sub.?domain/i },
  { key: 'code', label: 'Code', guess: /code|^id$|ref/i },
  { key: 'text', label: 'Objective text', required: true, guess: /objective|outcome|descript|competenc|standard|content|text|skill/i },
];

const letter = (i: number): string => (i >= 26 ? letter(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));

/** First row with at least two filled cells that look like headings. */
function guessHeader(rows: string[][]): number {
  const i = rows.findIndex((r) => r.filter((c) => c.trim()).length >= 2 && FIELDS.some((f) => r.some((c) => f.guess.test(c))));
  return i >= 0 ? i + 1 : 1;
}

function guessColumns(header: string[]): ColumnMap {
  const used = new Set<number>();
  const find = (re: RegExp) => {
    const i = header.findIndex((h, j) => !used.has(j) && re.test(h.trim()));
    if (i >= 0) used.add(i);
    return i >= 0 ? i : null;
  };
  // sub-strand before strand, so "Sub-strand" isn't taken as the strand
  const subStrand = find(FIELDS[2]!.guess);
  const strand = find(FIELDS[1]!.guess);
  return { grade: find(FIELDS[0]!.guess) ?? -1, strand, subStrand, code: find(FIELDS[3]!.guess), text: find(FIELDS[4]!.guess) ?? -1 };
}

export function NewCurriculumPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [sheet, setSheet] = useState('');
  const [headerRow, setHeaderRow] = useState(1);
  const [columns, setColumns] = useState<ColumnMap>({ grade: -1, text: -1, strand: null, subStrand: null, code: null });
  const [splitBullets, setSplit] = useState(true);
  const [fillDown, setFillDown] = useState(true);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [meta, setMeta] = useState({ code: '', name: '', country: '', version: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const grid = upload?.sheets.find((s) => s.name === sheet);
  const header = grid?.rows[headerRow - 1] ?? [];
  const width = Math.max(0, ...(grid?.rows.map((r) => r.length) ?? [0]));
  const ready = columns.grade >= 0 && columns.text >= 0;

  const run = async <T,>(fn: () => Promise<T>) => {
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const chooseSheet = (name: string, u = upload) => {
    const s = u?.sheets.find((x) => x.name === name);
    setSheet(name);
    setPreview(null);
    if (!s) return;
    const h = guessHeader(s.rows);
    setHeaderRow(h);
    setColumns(guessColumns(s.rows[h - 1] ?? []));
  };

  const onFile = (file: File | undefined) =>
    file &&
    run(async () => {
      const fd = new FormData();
      fd.append('file', file);
      const u = await send<UploadResult>('POST', '/uploads', fd);
      setUpload(u);
      const best = [...u.sheets].sort((a, b) => b.rowCount - a.rowCount)[0];
      chooseSheet(best?.name ?? '', u);
      setMeta((m) => ({ ...m, name: m.name || file.name.replace(/\.[^.]+$/, '') }));
    });

  const body = { sheet, headerRow, columns, splitBullets, fillDown };
  const doPreview = () => run(async () => setPreview(await send<UploadPreview>('POST', `/uploads/${upload!.uploadId}/preview`, body)));
  const create = () =>
    run(async () => {
      const res = await send<{ id: string }>('POST', '/curricula', { ...body, uploadId: upload!.uploadId, ...meta, version: meta.version || undefined });
      await qc.invalidateQueries({ queryKey: ['curricula'] });
      nav(`/runs?curriculum=${res.id}`);
    });

  const setCol = (key: keyof ColumnMap, v: string) => {
    setColumns((c) => ({ ...c, [key]: v === '' ? (key === 'grade' || key === 'text' ? -1 : null) : Number(v) }));
    setPreview(null);
  };

  const shownRows = useMemo(() => grid?.rows.slice(0, 30) ?? [], [grid]);

  return (
    <div style={{ maxWidth: 1200 }}>
      <h1>New curriculum</h1>
      <p className="muted">Upload a spreadsheet of objectives, pick the columns, check the preview, then create it. Matching is a separate step.</p>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>1. File</h3>
        <input type="file" accept=".xlsx,.xlsm,.xls,.csv" onChange={(e) => onFile(e.target.files?.[0])} disabled={busy} />
        {upload && (
          <span className="muted small" style={{ marginLeft: 8 }}>
            {upload.fileName}
          </span>
        )}
      </div>

      {upload && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>2. Sheet and columns</h3>
          <div className="filters">
            <label>
              Sheet{' '}
              <select value={sheet} onChange={(e) => chooseSheet(e.target.value)}>
                {upload.sheets.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name} ({s.rowCount} rows)
                  </option>
                ))}
              </select>
            </label>
            <label>
              Header row{' '}
              <input
                type="number"
                min={0}
                value={headerRow}
                style={{ width: 64 }}
                onChange={(e) => {
                  const h = Number(e.target.value);
                  setHeaderRow(h);
                  setColumns(guessColumns(grid?.rows[h - 1] ?? []));
                  setPreview(null);
                }}
              />
            </label>
            <span className="small muted">0 = no header row</span>
          </div>
          <div className="filters">
            {FIELDS.map((f) => (
              <label key={f.key}>
                {f.label}
                {f.required ? ' *' : ''}{' '}
                <select value={columns[f.key] === null || columns[f.key] === -1 ? '' : String(columns[f.key])} onChange={(e) => setCol(f.key, e.target.value)}>
                  <option value="">{f.required ? 'choose…' : '(none)'}</option>
                  {Array.from({ length: width }, (_, i) => (
                    <option key={i} value={i}>
                      {letter(i)}
                      {header[i] ? `: ${header[i].slice(0, 30)}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="filters">
            <label>
              <input type="checkbox" checked={splitBullets} onChange={(e) => (setSplit(e.target.checked), setPreview(null))} /> One objective per bullet or line in a cell
            </label>
            <label>
              <input type="checkbox" checked={fillDown} onChange={(e) => (setFillDown(e.target.checked), setPreview(null))} /> Fill empty grade / strand cells from the row above
            </label>
          </div>

          <div style={{ overflow: 'auto', maxHeight: 360, border: '1px solid var(--border)', borderRadius: 6 }}>
            <table className="small">
              <thead>
                <tr>
                  <th>#</th>
                  {Array.from({ length: width }, (_, i) => {
                    const f = FIELDS.find((x) => columns[x.key] === i);
                    return (
                      <th key={i} style={f ? { color: 'var(--accent)' } : undefined}>
                        {letter(i)}
                        {f ? ` · ${f.label}` : ''}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {shownRows.map((r, i) => (
                  <tr key={i} style={i + 1 === headerRow ? { fontWeight: 600, background: 'var(--surface-2)' } : i + 1 < headerRow ? { opacity: 0.5 } : undefined}>
                    <td className="muted">{i + 1}</td>
                    {Array.from({ length: width }, (_, j) => (
                      <td key={j} style={{ maxWidth: 320, whiteSpace: 'pre-wrap' }}>
                        {(r[j] ?? '').slice(0, 160)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <button onClick={doPreview} disabled={!ready || busy}>
              Preview objectives
            </button>
          </p>
        </div>
      )}

      {preview && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>3. Preview</h3>
          <p>
            <b>{preview.count}</b> objectives:{' '}
            {Object.entries(preview.byGrade)
              .map(([g, n]) => `${g} ${n}`)
              .join(' · ')}
            {preview.skippedCount > 0 && <span className="muted"> · {preview.skippedCount} rows skipped</span>}
          </p>
          {preview.warnings.map((w) => (
            <p key={w} className="s-rejected">
              {w}
            </p>
          ))}
          {preview.skipped.length > 0 && (
            <details>
              <summary>Skipped rows</summary>
              <ul className="small">
                {preview.skipped.map((s, i) => (
                  <li key={i}>
                    Row {s.row}: {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div style={{ overflow: 'auto', maxHeight: 400, marginTop: 8 }}>
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Grade</th>
                  <th>Strand</th>
                  <th>Code</th>
                  <th>Objective</th>
                </tr>
              </thead>
              <tbody>
                {preview.objectives.map((o, i) => (
                  <tr key={i}>
                    <td className="muted">{o.row}</td>
                    <td>
                      {o.gradeLabel}
                      {o.gradeNum === null && <span className="tag">no number</span>}
                    </td>
                    <td>
                      {o.strand}
                      {o.subStrand && <div className="small muted">{o.subStrand}</div>}
                    </td>
                    <td className="mono">{o.code}</td>
                    <td>{o.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.count > preview.objectives.length && <p className="small muted">Showing the first {preview.objectives.length}.</p>}
          </div>

          <h3>4. Name it</h3>
          <div className="filters">
            <input placeholder="Code, e.g. NZ-2025" value={meta.code} onChange={(e) => setMeta({ ...meta, code: e.target.value })} />
            <input placeholder="Name" style={{ minWidth: 320 }} value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
            <input placeholder="Country, e.g. NZ" value={meta.country} onChange={(e) => setMeta({ ...meta, country: e.target.value })} />
            <input placeholder="Version (optional)" value={meta.version} onChange={(e) => setMeta({ ...meta, version: e.target.value })} />
            <button className="primary" onClick={create} disabled={busy || !preview.count || !meta.code || !meta.name || !meta.country}>
              Create curriculum
            </button>
          </div>
        </div>
      )}
      {error && <p className="s-rejected">{error}</p>}
    </div>
  );
}
