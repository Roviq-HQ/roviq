-- Default parent roles may only read their linked children's attendance; custom roles are untouched.
WITH scoped AS (
  SELECT r.id, jsonb_agg(
    CASE WHEN rule->>'subject' = 'Attendance'
      AND rule->>'action' = 'read'
      AND COALESCE((rule->>'inverted')::boolean, false) = false
      AND NOT rule ? 'conditions'
    THEN jsonb_set(rule, '{conditions}', '{"studentProfileId":{"$in":"$user.linkedStudentIds"}}'::jsonb)
    ELSE rule END ORDER BY ordinal
  ) AS abilities
  FROM roles r, jsonb_array_elements(r.abilities) WITH ORDINALITY AS entries(rule, ordinal)
  WHERE r.scope = 'institute' AND r.is_default = true AND r.deleted_at IS NULL
    AND r.name->>'en' = 'parent'
  GROUP BY r.id
)
UPDATE roles r SET abilities = scoped.abilities, version = r.version + 1, updated_at = NOW()
FROM scoped WHERE r.id = scoped.id AND r.abilities IS DISTINCT FROM scoped.abilities;
