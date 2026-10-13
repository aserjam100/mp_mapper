/**
 * `pnpm embed` — embed every objective that has no vector yet.
 * `pnpm match --curriculum PH-DEPED [--accuracy] [--editions PH_DPA,PINE] [--window 1] [--judge] [--consent]`
 *   Runs retrieval, prints the judge estimate, and then either judges (only with --judge; --consent records the
 *   go-ahead to send product content to the Anthropic API) or finishes on retrieval order alone.
 *   Accuracy runs write docs/accuracy-<curriculum>.md.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { sqlClient as sql } from '../db/client.js';
import { getExternalConsent, giveExternalConsent } from '../lib/settings.js';
import { renderAccuracy, type AccuracyReport } from './accuracy.js';
import { ensureEmbeddings } from './embed.js';
import { createRun, finishWithoutJudge, judgeStage, retrieveStage } from './run.js';

const log = (s: string) => console.log(s);
const [command, ...rest] = process.argv.slice(2);

try {
  if (command === 'embed') {
    const n = await ensureEmbeddings(log);
    log(`Embedded ${n.curriculum} curriculum and ${n.product} product objectives.`);
  } else if (command === 'match') {
    const { values } = parseArgs({
      args: rest,
      options: {
        curriculum: { type: 'string' },
        accuracy: { type: 'boolean', default: false },
        editions: { type: 'string' },
        window: { type: 'string' },
        judge: { type: 'boolean', default: false },
        consent: { type: 'boolean', default: false },
      },
    });
    if (!values.curriculum) throw new Error('--curriculum <code> is required (e.g. PH-DEPED)');
    const [cu] = await sql`SELECT id, code FROM curricula WHERE code = ${values.curriculum}`;
    if (!cu) throw new Error(`No curriculum with code ${values.curriculum}`);
    const editions = values.editions?.split(',') ?? (values.accuracy && cu.code === 'PH-DEPED' ? ['PH_DPA'] : ['PINE', 'AU2', 'PH_DPA']);
    const mode = values.accuracy ? 'accuracy' : 'propose';
    const runId = await createRun({ curriculumId: cu.id, mode, editions, gradeWindow: values.window ? Number(values.window) : undefined, actor: 'cli' });
    log(`Run ${runId} (${mode}) for ${cu.code} on ${editions.join(', ')}`);
    await retrieveStage(runId, log);

    if (values.judge) {
      if (values.consent && !(await getExternalConsent())) await giveExternalConsent('cli --consent');
      await judgeStage(runId, log);
    } else {
      await finishWithoutJudge(runId);
    }
    const [run] = await sql`SELECT * FROM matching_runs WHERE id = ${runId}`;
    const report = run!.report as { accuracy?: AccuracyReport; written?: unknown; usd?: number };
    if (report.accuracy) {
      const md = renderAccuracy(cu.code, runId, report.accuracy, {
        embedModel: run!.embed_model,
        llmModel: run!.llm_model,
        gradeWindow: (run!.params as { gradeWindow: number }).gradeWindow,
        usd: report.usd,
      });
      const file = resolve(import.meta.dirname, `../../../../docs/accuracy-${cu.code}${report.accuracy.judged ? '' : '-retrieval'}.md`);
      writeFileSync(file, md);
      const t = report.accuracy.total;
      log(`Best match ${t.bestFound}/${t.objectives}, top 3 ${t.top3}/${t.objectives}, in list ${t.anywhere}/${t.objectives}. Report: ${file}`);
    } else {
      log(`Done. Mappings: ${JSON.stringify(report.written)}`);
    }
  } else {
    throw new Error('Usage: cli.ts embed | match --curriculum <code> [...]');
  }
} finally {
  await sql.end();
}
