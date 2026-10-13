import { curriculumId as curriculumIdOf, curriculumObjectiveId, normText } from '@mapper/shared';
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { sqlClient as sql } from '../db/client.js';
import { getExternalConsent, getSetting, giveExternalConsent } from '../lib/settings.js';
import { renderAccuracy, type AccuracyReport } from '../matching/accuracy.js';
import { embedConfig, embedLabel } from '../matching/embed.js';
import { judgeModel } from '../matching/judge.js';
import type { Candidate } from '../matching/retrieve.js';
import { createRun, finishWithoutJudge, judgeStage, retrieveStage } from '../matching/run.js';
import { parseObjectives, previewSheets, readGrids } from '../matching/upload.js';

const UPLOAD_DIR = resolve(import.meta.dirname, '../../../../data/uploads');
const EDITION_CODES = ['PINE', 'AU2', 'PH_DPA'];

export const match = new Hono();

// ---------------------------------------------------------------- settings / status

match.get('/matching/status', async (c) => {
  const cfg = embedConfig();
  let ollama: boolean | null = null;
  if (cfg.provider === 'ollama') {
    try {
      const res = await fetch(`${process.env.OLLAMA_URL ?? 'http://localhost:11434'}/api/tags`, { signal: AbortSignal.timeout(1500) });
      ollama = res.ok;
    } catch {
      ollama = false;
    }
  }
  const [counts] = await sql`
    SELECT (SELECT count(*) FROM product_objectives WHERE status = 'active' AND embedding IS NULL)::int AS product_missing,
           (SELECT count(*) FROM curriculum_objectives WHERE status = 'active' AND embedding IS NULL AND coalesce(meta->>'stub','false') <> 'true')::int AS curriculum_missing`;
  return c.json({
    embedding: { label: embedLabel(cfg), provider: cfg.provider, ollama, stored: await getSetting('embedding'), missing: counts },
    judge: { model: judgeModel(), effort: process.env.JUDGE_EFFORT ?? 'low', hasKey: !!process.env.ANTHROPIC_API_KEY },
    consent: await getExternalConsent(),
  });
});

// ---------------------------------------------------------------- upload a new curriculum

match.post('/uploads', async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({ error: 'No file' }, 400);
  if (!/\.(xlsx|xlsm|xls|csv)$/i.test(file.name)) return c.json({ error: 'Upload an .xlsx, .xls or .csv file' }, 400);
  const buf = Buffer.from(await file.arrayBuffer());
  const grids = readGrids(buf);
  const id = randomUUID();
  mkdirSync(UPLOAD_DIR, { recursive: true });
  writeFileSync(resolve(UPLOAD_DIR, `${id}.bin`), buf);
  writeFileSync(resolve(UPLOAD_DIR, `${id}.json`), JSON.stringify({ name: file.name, size: buf.length }));
  return c.json({ uploadId: id, fileName: file.name, sheets: previewSheets(grids) });
});

const ParseBody = z.object({
  sheet: z.string(),
  headerRow: z.number().int().min(0),
  columns: z.object({
    grade: z.number().int().min(0),
    text: z.number().int().min(0),
    strand: z.number().int().nullable().optional(),
    subStrand: z.number().int().nullable().optional(),
    code: z.number().int().nullable().optional(),
  }),
  splitBullets: z.boolean().default(true),
  fillDown: z.boolean().default(true),
});

function loadUpload(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Bad upload id');
  const path = resolve(UPLOAD_DIR, `${id}.bin`);
  if (!existsSync(path)) throw new Error('Upload not found; upload the file again');
  const meta = JSON.parse(readFileSync(resolve(UPLOAD_DIR, `${id}.json`), 'utf8')) as { name: string };
  return { grids: readGrids(readFileSync(path)), name: meta.name };
}

function parseUpload(id: string, p: z.infer<typeof ParseBody>) {
  const { grids, name } = loadUpload(id);
  const rows = grids.get(p.sheet);
  if (!rows) throw new Error(`Sheet "${p.sheet}" not found`);
  return { name, ...parseObjectives(rows, p) };
}

match.post('/uploads/:id/preview', async (c) => {
  const p = ParseBody.parse(await c.req.json());
  const out = parseUpload(c.req.param('id'), p);
  const byGrade: Record<string, number> = {};
  for (const o of out.objectives) byGrade[o.gradeLabel] = (byGrade[o.gradeLabel] ?? 0) + 1;
  return c.json({ count: out.objectives.length, byGrade, objectives: out.objectives.slice(0, 300), skipped: out.skipped.slice(0, 100), skippedCount: out.skipped.length, warnings: out.warnings });
});

const CreateBody = ParseBody.extend({
  uploadId: z.string(),
  code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_.-]+$/, 'Use letters, numbers, - _ . only'),
  name: z.string().trim().min(2),
  country: z.string().trim().min(2).max(40),
  version: z.string().trim().optional(),
});

match.post('/curricula', async (c) => {
  const p = CreateBody.parse(await c.req.json());
  const [existing] = await sql`SELECT id FROM curricula WHERE code = ${p.code}`;
  if (existing) return c.json({ error: `A curriculum with code ${p.code} already exists` }, 409);
  const out = parseUpload(p.uploadId, p);
  if (!out.objectives.length) return c.json({ error: 'No objectives to import' }, 400);
  const id = curriculumIdOf(p.code);
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO curricula (id, code, name, country, version, publisher_owned, source_file, meta)
      VALUES (${id}, ${p.code}, ${p.name}, ${p.country}, ${p.version ?? null}, false, ${out.name},
        ${JSON.stringify({ upload: { sheet: p.sheet, headerRow: p.headerRow, columns: p.columns, splitBullets: p.splitBullets, fillDown: p.fillDown } })}::jsonb)`;
    const rows = out.objectives.map((o, i) => ({
      id: curriculumObjectiveId(p.code, o.key),
      curriculum_id: id,
      code: o.code,
      grade_label: o.gradeLabel,
      grade_num: o.gradeNum,
      strand: o.strand,
      sub_strand: o.subStrand,
      text: o.text,
      text_norm: normText(o.text),
      sort_key: `${String(o.gradeNum ?? 99).padStart(2, '0')}|${String(i).padStart(5, '0')}`,
      meta: JSON.stringify({ sourceRow: o.row }),
    }));
    for (let i = 0; i < rows.length; i += 500) await tx`INSERT INTO curriculum_objectives ${tx(rows.slice(i, i + 500))}`;
  });
  return c.json({ id, objectives: out.objectives.length, skipped: out.skipped.length });
});

// ---------------------------------------------------------------- runs

const RunBody = z.object({
  curriculumId: z.string().uuid(),
  mode: z.enum(['propose', 'accuracy']).default('propose'),
  editions: z.array(z.enum(EDITION_CODES as [string, ...string[]])).min(1),
  gradeWindow: z.number().int().min(0).max(6).default(1),
});

const background = (p: Promise<unknown>) => p.catch(() => {}); // failures are recorded on the run

match.post('/runs', async (c) => {
  const p = RunBody.parse(await c.req.json());
  const busy = await sql`SELECT id FROM matching_runs WHERE status IN ('retrieving', 'judging', 'finishing')`;
  if (busy.length) return c.json({ error: 'Another run is in progress; wait for it to finish' }, 409);
  const id = await createRun({ ...p, actor: 'web' });
  background(retrieveStage(id));
  return c.json({ id });
});

match.get('/runs', async (c) => {
  const rows = await sql`
    SELECT r.id, r.mode, r.status, r.params, r.embed_model, r.llm_model, r.est_cost, r.actual_cost, r.started_at, r.finished_at, r.progress, r.error,
      r.report->'accuracy'->'total' AS accuracy_total, r.report->'accuracy'->'judged' AS accuracy_judged,
      cu.id AS curriculum_id, cu.code AS curriculum_code, cu.name AS curriculum_name
    FROM matching_runs r JOIN curricula cu ON cu.id = r.curriculum_id ORDER BY r.started_at DESC LIMIT 100`;
  return c.json(rows);
});

match.get('/runs/:id', async (c) => {
  const id = c.req.param('id');
  const [run] = await sql`
    SELECT r.*, cu.code AS curriculum_code, cu.name AS curriculum_name
    FROM matching_runs r JOIN curricula cu ON cu.id = r.curriculum_id WHERE r.id = ${id}`;
  if (!run) return c.json({ error: 'not found' }, 404);
  const summary = await sql`
    SELECT e.code AS edition, coalesce(mr.rating::text, CASE WHEN mr.chosen_location_id IS NULL THEN 'none' ELSE 'unjudged' END) AS rating, count(*)::int AS n
    FROM match_results mr JOIN editions e ON e.id = mr.edition_id WHERE mr.run_id = ${id} GROUP BY 1, 2`;
  return c.json({ run, summary, consent: await getExternalConsent(), hasKey: !!process.env.ANTHROPIC_API_KEY });
});

match.get('/runs/:id/results', async (c) => {
  const id = c.req.param('id');
  const rows = await sql`
    SELECT mr.curriculum_objective_id, e.code AS edition, mr.rating, mr.note, mr.judged, mr.judge_error, mr.mapping_id,
      mr.chosen_location_id, mr.candidates, co.code, co.grade_label, co.strand, co.text
    FROM match_results mr JOIN editions e ON e.id = mr.edition_id JOIN curriculum_objectives co ON co.id = mr.curriculum_objective_id
    WHERE mr.run_id = ${id} ORDER BY co.sort_key, e.code`;
  const byObjective = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const o = byObjective.get(r.curriculum_objective_id) ?? {
      id: r.curriculum_objective_id,
      code: r.code,
      grade_label: r.grade_label,
      strand: r.strand,
      text: r.text,
      cells: {} as Record<string, unknown>,
    };
    const cands = r.candidates as (Candidate & { judge?: string })[];
    const chosen = cands.find((x) => x.locationId === r.chosen_location_id) ?? null;
    (o.cells as Record<string, unknown>)[r.edition] = {
      rating: r.rating,
      note: r.note,
      judged: r.judged,
      error: r.judge_error,
      mappingId: r.mapping_id,
      chosen: chosen && { label: chosen.label, locationId: chosen.locationId, scopeNotes: chosen.scopeNotes, reuse: !!chosen.reuse?.length, bullets: chosen.bullets.map((b) => b.text) },
      candidates: cands.map((x) => ({ key: x.key, label: x.label, locationId: x.locationId, type: x.type, gradeNum: x.gradeNum, judge: x.judge ?? null, sources: x.sources, scopeNotes: x.scopeNotes })),
    };
    byObjective.set(r.curriculum_objective_id, o);
  }
  return c.json([...byObjective.values()]);
});

match.post('/runs/:id/judge', async (c) => {
  const id = c.req.param('id');
  const { consent } = z.object({ consent: z.boolean().default(false) }).parse(await c.req.json().catch(() => ({})));
  if (!process.env.ANTHROPIC_API_KEY) return c.json({ error: 'ANTHROPIC_API_KEY is not set in .env (restart pnpm dev after setting it)' }, 400);
  if (!(await getExternalConsent())) {
    if (!consent) return c.json({ error: 'consent required', needsConsent: true }, 409);
    await giveExternalConsent('web');
  }
  const [run] = await sql`SELECT status FROM matching_runs WHERE id = ${id}`;
  if (run?.status !== 'ready') return c.json({ error: 'Run is not ready for judging' }, 409);
  background(judgeStage(id));
  return c.json({ ok: true });
});

match.post('/runs/:id/finish', async (c) => {
  await finishWithoutJudge(c.req.param('id'));
  return c.json({ ok: true });
});

match.get('/runs/:id/accuracy.md', async (c) => {
  const [run] = await sql`SELECT r.*, cu.code FROM matching_runs r JOIN curricula cu ON cu.id = r.curriculum_id WHERE r.id = ${c.req.param('id')}`;
  const report = run?.report as { accuracy?: AccuracyReport; usd?: number } | undefined;
  if (!report?.accuracy) return c.json({ error: 'No accuracy report for this run' }, 404);
  const md = renderAccuracy(run!.code, run!.id, report.accuracy, {
    embedModel: run!.embed_model,
    llmModel: run!.llm_model,
    gradeWindow: (run!.params as { gradeWindow: number }).gradeWindow,
    usd: report.usd,
  });
  return c.body(md, 200, { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="accuracy-${run!.code}.md"` });
});

