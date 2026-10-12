-- Same ordering as 0002, computed with window functions (the correlated count made it O(n^2)).
DROP VIEW coverage_best;
--> statement-breakpoint
CREATE VIEW coverage_best AS
SELECT * FROM (
  SELECT mc.*,
    pl.grade_num AS location_grade,
    count(*) OVER w_all AS candidate_count,
    row_number() OVER (
      PARTITION BY mc.curriculum_objective_id, mc.edition_id
      ORDER BY
        (mc.role = 'best') DESC,
        (mc.role = 'related') ASC,
        CASE mc.rating WHEN 'covered' THEN 0 WHEN 'check' THEN 1 ELSE 2 END,
        CASE pl.type WHEN 'teaching' THEN 0 WHEN 'practice' THEN 1 WHEN 'problem_solving' THEN 1 ELSE 2 END,
        pl.optional,
        pl.supplement,
        abs(pl.grade_num - coalesce(co.grade_num, pl.grade_num)),
        pl.sort_key
    ) AS rank
  FROM mapping_current mc
  JOIN product_locations pl ON pl.id = mc.product_location_id
  JOIN curriculum_objectives co ON co.id = mc.curriculum_objective_id
  WHERE mc.status <> 'rejected'
  WINDOW w_all AS (PARTITION BY mc.curriculum_objective_id, mc.edition_id)
) ranked
WHERE rank = 1;
