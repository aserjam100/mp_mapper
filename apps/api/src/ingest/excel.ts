import ExcelJS from 'exceljs';

export async function loadWorkbook(path: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  return wb;
}

/**
 * Plain text of a cell. Formulas give their cached result, rich text is flattened,
 * and merged cells give the master cell's value (which is how merged chapter cells fill down).
 */
export function cellText(cell: ExcelJS.Cell | undefined): string {
  if (!cell) return '';
  const v = cell.value as unknown;
  return valueText(v);
}

function valueText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((r) => r.text).join('');
    if ('result' in o) return valueText(o.result);
    if ('formula' in o || 'sharedFormula' in o) return '';
    if ('text' in o) return valueText(o.text);
    if ('error' in o) return '';
  }
  return String(v);
}

export function getSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const ws = wb.getWorksheet(name);
  if (!ws) throw new Error(`Sheet "${name}" not found (have: ${wb.worksheets.map((w) => w.name).join(', ')})`);
  return ws;
}

/** Text of columns 1..n of a row (1-based columns -> 0-based array). */
export function rowTexts(ws: ExcelJS.Worksheet, rowNo: number, n: number): string[] {
  const row = ws.getRow(rowNo);
  const out: string[] = [];
  for (let c = 1; c <= n; c++) out.push(cellText(row.getCell(c)));
  return out;
}

export function argb(color: Partial<ExcelJS.Color> | undefined): string | null {
  return color && typeof color.argb === 'string' ? color.argb.toUpperCase() : null;
}

/** Fill colour and font colour of a cell, as ARGB strings (null = none / theme default). */
export function cellColours(cell: ExcelJS.Cell): { fill: string | null; font: string | null } {
  const fill = cell.fill && cell.fill.type === 'pattern' ? argb((cell.fill as ExcelJS.FillPattern).fgColor) : null;
  return { fill, font: argb(cell.font?.color) };
}

/** Minimal read-only grid (1-based rows/columns) for files ExcelJS cannot open. */
export interface Grid {
  name: string;
  rowCount: number;
  get(row: number, col: number): string;
}

/**
 * Read sheets with SheetJS. Used for the SG crosswalk, whose package uses absolute part paths
 * (`/xl/workbook.xml`) that ExcelJS rejects. Values are cached results; no styles.
 */
export async function loadGrids(path: string, sheets: string[]): Promise<Map<string, Grid>> {
  const XLSX = await import('xlsx');
  const { readFileSync } = await import('node:fs');
  const wb = XLSX.read(readFileSync(path), { type: 'buffer', sheets, cellStyles: false, cellHTML: false });
  const out = new Map<string, Grid>();
  for (const name of sheets) {
    const ws = wb.Sheets[name];
    if (!ws) throw new Error(`Sheet "${name}" not found in ${path}`);
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
    out.set(name, {
      name,
      rowCount: range.e.r + 1,
      get: (r, c) => {
        const cell = ws[XLSX.utils.encode_cell({ r: r - 1, c: c - 1 })] as { v?: unknown } | undefined;
        return cell?.v === null || cell?.v === undefined ? '' : String(cell.v);
      },
    });
  }
  return out;
}
