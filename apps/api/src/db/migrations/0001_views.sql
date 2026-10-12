-- Current state of every mapping = its latest version (mapping_versions is append-only).
CREATE VIEW mapping_current AS
SELECT DISTINCT ON (mv.mapping_id)
  m.id AS mapping_id, m.curriculum_objective_id, m.edition_id, m.product_location_id, m.product_objective_id,
  mv.id AS version_id, mv.version, mv.rating, mv.role, mv.status, mv.scope_note, mv.related_note,
  mv.source, mv.matching_run_id, mv.import_batch_id, mv.actor, mv.note, mv.created_at AS updated_at
FROM mappings m
JOIN mapping_versions mv ON mv.mapping_id = m.id
ORDER BY mv.mapping_id, mv.version DESC;
