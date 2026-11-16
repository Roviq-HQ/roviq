-- Attendance entries store the student's membership id; the old rule compared it with the user id.
WITH scoped AS (
  SELECT r.id, jsonb_agg(
    CASE WHEN rule->>'subject' = 'Attendance'
      AND rule->>'action' = 'read'
      AND rule->'conditions' = '{"studentId":"${user.id}"}'::jsonb
    THEN jsonb_set(rule, '{conditions}', '{"studentId":"$user.membershipId"}'::jsonb)
    ELSE rule END ORDER BY ordinal
  ) AS abilities
  FROM roles r, jsonb_array_elements(r.abilities) WITH ORDINALITY AS entries(rule, ordinal)
  WHERE r.scope = 'institute' AND r.is_default = true AND r.deleted_at IS NULL
    AND r.name->>'en' = 'student'
  GROUP BY r.id
)
UPDATE roles r SET abilities = scoped.abilities, version = r.version + 1, updated_at = NOW()
FROM scoped WHERE r.id = scoped.id AND r.abilities IS DISTINCT FROM scoped.abilities;
