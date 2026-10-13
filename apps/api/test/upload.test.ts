import { describe, expect, it } from 'vitest';
import { parseObjectives } from '../src/matching/upload.js';

const rows = [
  ['Mathematics syllabus'],
  ['Level', 'Strand', 'Code', 'Learning outcome'],
  ['Grade 1', 'Number', 'N1.1', 'Count to 100'],
  ['', '', 'N1.2', '•\tAdd within 20\n•\tSubtract within 20'],
  ['', 'Measurement', '', 'Compare lengths'],
  ['Grade 2', 'Number', 'N1.1', 'Count to 1000'],
  ['', '', '', ''],
  ['Grade 2', 'Number', 'N2.9', ''],
];

const opts = { headerRow: 2, columns: { grade: 0, strand: 1, code: 2, text: 3 }, splitBullets: true, fillDown: true };

describe('parseObjectives', () => {
  it('maps columns, fills down grade and strand, splits bullets', () => {
    const out = parseObjectives(rows, opts);
    expect(out.objectives.map((o) => [o.row, o.code, o.gradeNum, o.strand, o.text])).toEqual([
      [3, 'N1.1', 1, 'Number', 'Count to 100'],
      [4, 'N1.2.1', 1, 'Number', 'Add within 20'],
      [4, 'N1.2.2', 1, 'Number', 'Subtract within 20'],
      [5, null, 1, 'Measurement', 'Compare lengths'],
    ]);
  });
  it('reports duplicates and rows without text', () => {
    const out = parseObjectives(rows, opts);
    expect(out.skipped).toEqual([
      { row: 6, reason: 'duplicate of row 3 (code N1.1)' },
      { row: 8, reason: 'no objective text' },
    ]);
  });
  it('keeps cells whole when splitting is off', () => {
    const out = parseObjectives(rows, { ...opts, splitBullets: false });
    expect(out.objectives[1]!.text).toBe('• Add within 20 • Subtract within 20');
  });
});
