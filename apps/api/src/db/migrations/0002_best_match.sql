-- Best current mapping per curriculum objective x edition, using the brief's preference order:
-- reviewer-chosen 'best' first, related-only notes last, then strongest rating, then teaching content over
-- review/assessment, non-optional over optional, non-supplement over supplement, product grade closest to
-- the curriculum grade, then book order. Rejected mappings never count.
CREATE VIEW coverage_best AS
SELECT DISTINCT ON (mc.curriculum_objective_id, mc.edition_id)
  mc.*,
  pl.grade_num AS location_grade,
  (SELECT count(*) FROM mapping_current x
    WHERE x.curriculum_objective_id = mc.curriculum_objective_id AND x.edition_id = mc.edition_id AND x.status <> 'rejected') AS candidate_count
FROM mapping_current mc
JOIN product_locations pl ON pl.id = mc.product_location_id
JOIN curriculum_objectives co ON co.id = mc.curriculum_objective_id
WHERE mc.status <> 'rejected'
ORDER BY mc.curriculum_objective_id, mc.edition_id,
  (mc.role = 'best') DESC,
  (mc.role = 'related') ASC,
  CASE mc.rating WHEN 'covered' THEN 0 WHEN 'check' THEN 1 ELSE 2 END,
  CASE pl.type WHEN 'teaching' THEN 0 WHEN 'practice' THEN 1 WHEN 'problem_solving' THEN 1 ELSE 2 END,
  pl.optional,
  pl.supplement,
  abs(pl.grade_num - coalesce(co.grade_num, pl.grade_num)),
  pl.sort_key;
