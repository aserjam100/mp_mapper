/**
 * Re-import semantics of loadMappings against the dev database (needs `pnpm db:up` + `pnpm ingest`).
 * Everything runs inside a transaction that is rolled back.
 */
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, sqlClient } from '../src/db/client.js';
import * as s from '../src/db/schema.js';
import { loadMappings, type MappingInput } from '../src/ingest/load.js';

const reachable = await sqlClient`SELECT count(*)::int AS n FROM mappings`.then((r) => r[0].n > 0).catch(() => false);
afterAll(() => sqlClient.end());

class Rollback extends Error {}

describe.skipIf(!reachable)('loadMappings re-import', () => {
  it('appends versions only when something changed, never overrides reviewers, withdraws removed links', async () => {
    const seen: Record<string, unknown> = {};
    await db
      .transaction(async (tx) => {
        const [{ batch }] = await tx.execute<{ batch: string }>(sql`INSERT INTO import_batches (kind, file, sha256) VALUES ('test','test','x') RETURNING id AS batch`);
        const locs = await tx.execute<{ id: string; edition: string }>(sql`
          SELECT pl.id, e.code AS edition FROM product_locations pl JOIN editions e ON e.id = pl.edition_id WHERE e.code = 'PINE' ORDER BY pl.sort_key LIMIT 3`);
        const objs = await tx.execute<{ id: string }>(sql`SELECT id FROM curriculum_objectives WHERE code LIKE 'SG-P1-%' ORDER BY sort_key LIMIT 1`);
        const make = (i: number, rating: MappingInput['rating']): MappingInput => ({
          curriculumObjectiveId: objs[0].id, edition: 'PINE', locationId: locs[i].id, productObjectiveId: null,
          rating, status: 'proposed', role: 'alternative', scopeNote: 'note', relatedNote: null, note: null,
        });

        seen.first = await loadMappings(tx, 'unit-test', batch, [make(0, 'check'), make(1, 'check'), make(2, 'check')]);
        seen.again = await loadMappings(tx, 'unit-test', batch, [make(0, 'check'), make(1, 'check'), make(2, 'check')]);

        // a reviewer edits link 1
        const [m1] = await tx.execute<{ mapping_id: string; version: number }>(sql`
          SELECT mapping_id, version FROM mapping_current WHERE product_location_id = ${locs[1].id} AND curriculum_objective_id = ${objs[0].id} AND product_objective_id IS NULL`);
        await tx.insert(s.mappingVersions).values({ mappingId: m1.mapping_id, version: m1.version + 1, rating: 'covered', role: 'best', status: 'approved', source: 'human', actor: 'reviewer' });

        // source changes link 0 and 1, drops link 2
        seen.changed = await loadMappings(tx, 'unit-test', batch, [make(0, 'covered'), make(1, 'not_found')]);
        seen.versions = (await tx.execute<{ source: string; status: string; rating: string; version: number }>(sql`
          SELECT mc.source, mc.status, mc.rating, mc.version FROM mapping_current mc
          WHERE mc.curriculum_objective_id = ${objs[0].id} AND mc.product_location_id IN (${locs[0].id}, ${locs[1].id}, ${locs[2].id}) AND mc.product_objective_id IS NULL
          ORDER BY array_position(ARRAY[${locs[0].id}, ${locs[1].id}, ${locs[2].id}]::uuid[], mc.product_location_id)`)).map((r) => ({ ...r }));
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });

    expect(seen.first).toMatchObject({ created: 3, updated: 0, unchanged: 0 });
    expect(seen.again).toMatchObject({ created: 0, updated: 0, unchanged: 3 });
    expect(seen.changed).toMatchObject({ created: 0, updated: 1, heldByReviewer: 1, withdrawn: 1 });
    expect(seen.versions).toEqual([
      { source: 'imported', status: 'proposed', rating: 'covered', version: 2 },
      { source: 'human', status: 'approved', rating: 'covered', version: 2 },
      { source: 'imported', status: 'rejected', rating: 'check', version: 2 },
    ]);
  });
});
