import { Hono } from 'hono';
import { sqlClient as sql } from '../db/client.js';
import { LOCATION_COLUMNS, locationLabel, type LocationLike } from '../lib/labels.js';

const COLS = sql.unsafe(LOCATION_COLUMNS);
const EDITION_ORDER = ['PINE', 'AU2', 'PH_DPA'];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const withLabel = <T extends Record<string, any>>(r: T) => ({ ...r, label: locationLabel(r as unknown as LocationLike) });

export const read = new Hono();

// ---------------------------------------------------------------- 1. curricula
read.get('/curricula', async (c) => {
  const curricula = await sql`
    SELECT c.id, c.code, c.name, c.country, c.version, c.publisher_owned, c.source_file,
      count(co.id) FILTER (WHERE co.status = 'active') AS objectives,
      count(co.id) FILTER (WHERE co.status = 'active' AND co.meta->>'stub' = 'true') AS stubs
    FROM curricula c LEFT JOIN curriculum_objectives co ON co.curriculum_id = c.id
    GROUP BY c.id ORDER BY c.publisher_owned, c.code`;
  const mappingCounts = await sql`
    SELECT co.curriculum_id, mc.rating, mc.status, count(*)::int AS n
    FROM mapping_current mc JOIN curriculum_objectives co ON co.id = mc.curriculum_objective_id
    GROUP BY 1, 2, 3`;
  const coverage = await sql`
    SELECT co.curriculum_id, e.code AS edition, b.rating, b.status, count(*)::int AS n
    FROM coverage_best b
    JOIN curriculum_objectives co ON co.id = b.curriculum_objective_id AND co.status = 'active'
    JOIN editions e ON e.id = b.edition_id
    GROUP BY 1, 2, 3, 4`;
  return c.json(
    curricula.map((cu) => ({
      ...cu,
      objectives: Number(cu.objectives),
      stubs: Number(cu.stubs),
      mappings: mappingCounts.filter((m) => m.curriculum_id === cu.id).map(({ curriculum_id, ...m }) => m),
      coverage: coverage.filter((m) => m.curriculum_id === cu.id).map(({ curriculum_id, ...m }) => m),
    })),
  );
});

// ---------------------------------------------------------------- 2. coverage overview
read.get('/curricula/:id/coverage', async (c) => {
  const id = c.req.param('id');
  const [curriculum] = await sql`SELECT * FROM curricula WHERE id = ${id}`;
  if (!curriculum) return c.json({ error: 'not found' }, 404);
  const objectives = await sql`
    SELECT id, code, grade_label, grade_num, track, strand, sub_strand, topic, objective_no, text, meta->>'stub' = 'true' AS stub
    FROM curriculum_objectives WHERE curriculum_id = ${id} AND status = 'active' ORDER BY sort_key`;
  const best = await sql`
    SELECT b.curriculum_objective_id, b.mapping_id, b.rating, b.status, b.role, b.scope_note, b.related_note, b.candidate_count::int, ${COLS}
    FROM coverage_best b
    JOIN curriculum_objectives co ON co.id = b.curriculum_objective_id AND co.curriculum_id = ${id}
    JOIN product_locations pl ON pl.id = b.product_location_id
    JOIN editions e ON e.id = b.edition_id`;
  const editions = EDITION_ORDER.filter((code) => best.some((b) => b.edition_code === code));
  const cells = new Map<string, Record<string, unknown>>();
  for (const b of best) {
    const row = cells.get(b.curriculum_objective_id) ?? {};
    row[b.edition_code] = {
      mappingId: b.mapping_id,
      rating: b.rating,
      status: b.status,
      role: b.role,
      scopeNote: b.scope_note,
      relatedNote: b.related_note,
      candidates: b.candidate_count,
      location: locationLabel(b as unknown as LocationLike),
      locationId: b.location_id,
      optional: b.optional,
      supplement: b.supplement,
      type: b.type,
    };
    cells.set(b.curriculum_objective_id, row);
  }
  return c.json({ curriculum, editions, objectives: objectives.map((o) => ({ ...o, cells: cells.get(o.id) ?? {} })) });
});

// ---------------------------------------------------------------- 3. objective detail
read.get('/objectives/:id', async (c) => {
  const id = c.req.param('id');
  const [objective] = await sql`
    SELECT co.*, cu.code AS curriculum_code, cu.name AS curriculum_name
    FROM curriculum_objectives co JOIN curricula cu ON cu.id = co.curriculum_id WHERE co.id = ${id}`;
  if (!objective) return c.json({ error: 'not found' }, 404);

  const mappings = await sql`
    SELECT mc.*, po.text AS product_objective_text, ${COLS}
    FROM mapping_current mc
    JOIN product_locations pl ON pl.id = mc.product_location_id
    JOIN editions e ON e.id = mc.edition_id
    LEFT JOIN product_objectives po ON po.id = mc.product_objective_id
    WHERE mc.curriculum_objective_id = ${id}`;
  const best = await sql`SELECT mapping_id FROM coverage_best WHERE curriculum_objective_id = ${id}`;
  const bestIds = new Set(best.map((b) => b.mapping_id));
  const history = mappings.length
    ? await sql`SELECT * FROM mapping_versions WHERE mapping_id IN ${sql(mappings.map((m) => m.mapping_id))} ORDER BY mapping_id, version`
    : [];
  // other editions delivering the same content ("also delivered in PH as …")
  const contentIds = [...new Set(mappings.map((m) => m.content_item_id))];
  const shared = contentIds.length
    ? await sql`SELECT ${COLS} FROM product_locations pl JOIN editions e ON e.id = pl.edition_id
                WHERE pl.content_item_id IN ${sql(contentIds)} AND pl.status = 'active' ORDER BY e.code, pl.sort_key`
    : [];
  // approved mappings from other curricula on the same content
  const relatedRows = contentIds.length
    ? await sql`
      SELECT DISTINCT ON (co2.id, pl.id) co2.id AS objective_id, co2.code, co2.text, co2.grade_label, cu2.code AS curriculum_code,
        mc2.rating, mc2.product_objective_id, ${COLS}
      FROM product_locations pl
      JOIN editions e ON e.id = pl.edition_id
      JOIN mapping_current mc2 ON mc2.product_location_id = pl.id AND mc2.status = 'approved'
      JOIN curriculum_objectives co2 ON co2.id = mc2.curriculum_objective_id AND co2.curriculum_id <> ${objective.curriculum_id}
      JOIN curricula cu2 ON cu2.id = co2.curriculum_id
      WHERE pl.content_item_id IN ${sql(contentIds)}
      ORDER BY co2.id, pl.id`
    : [];

  const byEdition = EDITION_ORDER.map((code) => ({
    edition: code,
    mappings: mappings
      .filter((m) => m.edition_code === code)
      .map((m) => ({
        ...withLabel(m),
        mapping_id: m.mapping_id,
        isBest: bestIds.has(m.mapping_id),
        alsoDeliveredIn: shared
          .filter((s) => s.content_item_id === m.content_item_id && s.location_id !== m.location_id)
          .map((s) => withLabel(s)),
        history: history.filter((h) => h.mapping_id === m.mapping_id),
      }))
      .sort((a, b) => Number(b.isBest) - Number(a.isBest) || String(a.label).localeCompare(String(b.label))),
  })).filter((g) => g.mappings.length);

  return c.json({ objective, editions: byEdition, related: relatedRows.map((r) => withLabel(r)) });
});

// ---------------------------------------------------------------- 4. product browser
read.get('/editions', async (c) => {
  const rows = await sql`
    SELECT e.id, e.code, e.name, e.short_name, count(pl.id)::int AS locations, array_agg(DISTINCT pl.grade_num ORDER BY pl.grade_num) AS grades
    FROM editions e LEFT JOIN product_locations pl ON pl.edition_id = e.id AND pl.status = 'active'
    GROUP BY e.id`;
  return c.json(EDITION_ORDER.map((code) => rows.find((r) => r.code === code)).filter(Boolean));
});

read.get('/editions/:code/locations', async (c) => {
  const code = c.req.param('code');
  const grade = Number(c.req.query('grade') ?? 1);
  const rows = await sql`
    WITH locs AS (
      SELECT pl.* FROM product_locations pl JOIN editions e ON e.id = pl.edition_id
      WHERE e.code = ${code} AND pl.grade_num = ${grade} AND pl.status = 'active'
    ),
    mapped AS MATERIALIZED (
      -- curriculum objectives mapped to each content item, through any edition's location
      SELECT pl2.content_item_id, cu.code, count(DISTINCT mc.curriculum_objective_id)::int AS n
      FROM product_locations pl2
      JOIN mapping_current mc ON mc.product_location_id = pl2.id AND mc.status <> 'rejected'
      JOIN curriculum_objectives co ON co.id = mc.curriculum_objective_id
      JOIN curricula cu ON cu.id = co.curriculum_id
      WHERE pl2.content_item_id IN (SELECT content_item_id FROM locs)
      GROUP BY 1, 2
    )
    SELECT ${COLS}, pl.parent_location_id,
      (SELECT count(*)::int FROM location_objectives lo WHERE lo.location_id = pl.id) AS objective_count,
      coalesce((SELECT json_agg(json_build_object('curriculum', m.code, 'n', m.n) ORDER BY m.code) FROM mapped m WHERE m.content_item_id = pl.content_item_id), '[]') AS mapped
    FROM locs pl JOIN editions e ON e.id = pl.edition_id
    ORDER BY pl.sort_key`;
  return c.json(rows.map((r) => withLabel(r)));
});

read.get('/locations/:id', async (c) => {
  const id = c.req.param('id');
  const [loc] = await sql`SELECT ${COLS}, pl.meta, pl.parent_location_id FROM product_locations pl JOIN editions e ON e.id = pl.edition_id WHERE pl.id = ${id}`;
  if (!loc) return c.json({ error: 'not found' }, 404);
  const objectives = await sql`
    SELECT po.id, po.text, po.ordinal, lo.link, ce.code AS origin_edition
    FROM location_objectives lo JOIN product_objectives po ON po.id = lo.product_objective_id
    JOIN content_items ci ON ci.id = po.content_item_id JOIN editions ce ON ce.id = ci.origin_edition_id
    WHERE lo.location_id = ${id} ORDER BY po.ordinal`;
  const shared = await sql`
    SELECT ${COLS} FROM product_locations pl JOIN editions e ON e.id = pl.edition_id
    WHERE pl.content_item_id = ${loc.content_item_id} AND pl.id <> ${id} AND pl.status = 'active' ORDER BY e.code, pl.sort_key`;
  const mapped = await sql`
    SELECT mc.mapping_id, mc.rating, mc.status, mc.role, mc.scope_note, mc.related_note, mc.product_objective_id, po.text AS product_objective_text,
      co.id AS objective_id, co.code, co.text, co.grade_label, cu.code AS curriculum_code, ${COLS}
    FROM product_locations pl
    JOIN editions e ON e.id = pl.edition_id
    JOIN mapping_current mc ON mc.product_location_id = pl.id AND mc.status <> 'rejected'
    JOIN curriculum_objectives co ON co.id = mc.curriculum_objective_id
    JOIN curricula cu ON cu.id = co.curriculum_id
    LEFT JOIN product_objectives po ON po.id = mc.product_objective_id
    WHERE pl.content_item_id = ${loc.content_item_id}
    ORDER BY cu.code, co.sort_key`;
  return c.json({
    location: withLabel(loc),
    objectives,
    sharedWith: shared.map((s) => withLabel(s)),
    mappings: mapped.map((m) => ({ ...withLabel(m), direct: m.location_id === id })),
  });
});
