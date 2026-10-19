import { describe, expect, it } from 'vitest';
import { snapshotFile } from './snapshot.js';

describe('snapshotFile', () => {
  it('maps API paths to data files', () => {
    expect(snapshotFile('/curricula')).toBe('/data/curricula.json');
    expect(snapshotFile('/curricula/abc/coverage')).toBe('/data/curricula/abc/coverage.json');
    expect(snapshotFile('/objectives/abc')).toBe('/data/objectives/abc.json');
    expect(snapshotFile('/locations/abc')).toBe('/data/locations/abc.json');
    expect(snapshotFile('/meta')).toBe('/data/meta.json');
  });

  it('turns the grade query into a path segment', () => {
    expect(snapshotFile('/editions/AU2/locations?grade=3')).toBe('/data/editions/AU2/locations/3.json');
  });

  it('rejects queries the snapshot does not save', () => {
    expect(() => snapshotFile('/editions/AU2/locations?grade=null')).toThrow();
    expect(() => snapshotFile('/runs?limit=5')).toThrow();
  });
});
