/**
 * Cut small test fixtures out of the real source files (`pnpm --filter @mapper/api fixtures`).
 * Rows keep their original row numbers, values (cached formula results), fonts, fills and merges,
 * so parser tests exercise the real quirks. Output: test/fixtures/*.xlsx
 */
import ExcelJS from 'exceljs';
import { resolve } from 'node:path';
import { cellText, loadGrids, loadWorkbook } from '../src/ingest/excel.js';

const SRC = resolve(import.meta.dirname, '../../../data/source');
const OUT = resolve(import.meta.dirname, '../test/fixtures');
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

async function cut(file: string, out: string, plan: Record<string, number[]>, hidden: string[] = []) {
  const src = await loadWorkbook(resolve(SRC, file));
  const dst = new ExcelJS.Workbook();
  for (const [sheet, rows] of Object.entries(plan)) {
    const ws = src.getWorksheet(sheet)!;
    const out = dst.addWorksheet(sheet, { state: hidden.includes(sheet) ? 'hidden' : 'visible' });
    const keep = new Set(rows);
    for (const r of rows) {
      const row = ws.getRow(r);
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        if (cell.isMerged && cell.master !== cell) return;
        const v = cell.value as unknown;
        const o = out.getCell(r, c);
        const isFormula = !!v && typeof v === 'object' && ('formula' in (v as object) || 'sharedFormula' in (v as object));
        o.value = (isFormula ? cellText(cell) : v) as ExcelJS.CellValue;
        if (cell.font) o.font = cell.font;
        if (cell.fill) o.fill = cell.fill;
      });
    }
    // merges fully inside kept rows
    for (const m of (ws.model.merges ?? []) as string[]) {
      const [, , r1, , r2] = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(m)!.slice(0).map((x, i) => (i === 2 || i === 4 ? Number(x) : x)) as [string, string, number, string, number];
      if (range(r1, r2).every((r) => keep.has(r))) out.mergeCells(m);
    }
  }
  await dst.xlsx.writeFile(resolve(OUT, out));
  console.log('wrote', out);
}

await cut('PINE learning objectives.xlsx', 'pine.xlsx', {
  'Grade 1': [...range(1, 34), ...range(189, 215), ...range(240, 256)],
  'Grade 5': [...range(1, 10), ...range(238, 252)],
});
await cut('PR1ME Scope and Sequence_AU2 Y1 to 6 030523.xlsx', 'au.xlsx', {
  'PR1ME AUS 1-6 objectives': [...range(1, 32), ...range(970, 980), ...range(1808, 1834), 2519, 2520],
});
await cut(
  'PH DPA S&S_Final_2 Jan 2024 1 (1).xlsx',
  'ph.xlsx',
  {
    'Grade 1': [...range(1, 12), ...range(48, 56), ...range(136, 152), ...range(200, 211)],
    'Grade 2': [1, 2],
    'Grade 3': [1, 2, ...range(57, 60)],
    'Grade 4': [1, 2, ...range(80, 85)],
    'Grade 5': [1, 2],
    'Grade 6': [1, 2, ...range(150, 158)],
    OPTIONAL: [...range(1, 10), ...range(99, 106)],
    'PH Curriculum': [...range(1, 8), ...range(117, 127)],
  },
  ['OPTIONAL'],
);

// SG crosswalk: ExcelJS cannot open it, so rebuild a small copy from SheetJS grids.
const grids = await loadGrids(resolve(SRC, 'Singapore_Product_Curriculum_Crosswalk.xlsx'), ['SG objectives', 'Match detail']);
const sg = new ExcelJS.Workbook();
const so = grids.get('SG objectives')!;
const md = grids.get('Match detail')!;
const copy = (g: typeof so, ws: ExcelJS.Worksheet, src: number, dst: number) => {
  for (let c = 1; c <= 40; c++) if (g.get(src, c) !== '') ws.getCell(dst, c).value = g.get(src, c);
};
const wso = sg.addWorksheet('SG objectives');
for (const r of range(1, 8)) copy(so, wso, r, r);
const wsm = sg.addWorksheet('Match detail');
for (const r of range(1, 5)) copy(md, wsm, r, r);
// pick rows whose source row is inside the product fixtures above, plus NZ and Missing Practices examples
const want: Record<string, (sheet: string, row: number) => boolean> = {
  PINE: (s, r) => s === 'Grade 1' && r >= 4 && r <= 34,
  'PR1ME Australia': (s, r) => r >= 6 && r <= 32,
  'PR1ME PH DPA': (s, r) => (s === 'Grade 1' && r >= 3 && r <= 12) || s === 'Missing Practices',
  'PR1ME NZ': () => true,
};
const got: Record<string, number> = {};
let out = 6;
for (let r = 6; r <= md.rowCount && out < 40; r++) {
  const ed = md.get(r, 9);
  const sheet = md.get(r, 36);
  const row = Number(md.get(r, 37).replace(/\D/g, ''));
  const key = ed + (sheet === 'Missing Practices' ? ' MP' : '');
  if (!['SG-P1-001', 'SG-P1-002', 'SG-P1-003', 'SG-P1-004'].includes(md.get(r, 1)) && sheet !== 'Missing Practices') continue;
  if (want[ed]?.(sheet, row) && (got[key] ?? 0) < (ed === 'PR1ME NZ' || key.endsWith('MP') ? 1 : 8)) {
    copy(md, wsm, r, out++);
    got[key] = (got[key] ?? 0) + 1;
  }
}
await sg.xlsx.writeFile(resolve(OUT, 'sg.xlsx'));
console.log('wrote sg.xlsx', got);
