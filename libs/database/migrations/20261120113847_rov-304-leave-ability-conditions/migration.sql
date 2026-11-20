-- ROV-304: leave rules are now applied to each leave, so the stored rules must be right.
-- No-op on a fresh database (the seed writes the current defaults).

-- 1. "Own leaves" compared leaves.user_id (a membership id) with the user id and never
--    matched. Every role holding that rule, default or customised, gets the membership id.
UPDATE roles
SET abilities = (
      SELECT jsonb_agg(
               CASE
                 WHEN rule->>'subject' = 'Leave' AND rule->'conditions' = '{"userId":"$user.sub"}'::jsonb
                   THEN jsonb_set(rule, '{conditions,userId}', '"$user.membershipId"'::jsonb)
                 ELSE rule
               END
               ORDER BY position
             )
      FROM jsonb_array_elements(abilities) WITH ORDINALITY AS item(rule, position)
    ),
    updated_at = now()
WHERE abilities @> '[{"subject":"Leave","conditions":{"userId":"$user.sub"}}]'::jsonb;
--> statement-breakpoint

-- 2. The default parent role read every leave of the institute. It now reads the leaves of
--    the guardian's own children.
UPDATE roles
SET abilities = (
      SELECT jsonb_agg(
               CASE
                 WHEN rule = '{"action":"read","subject":"Leave"}'::jsonb
                   THEN '{"action":"read","subject":"Leave","conditions":{"studentProfileId":{"$in":"$user.linkedStudentIds"}}}'::jsonb
                 ELSE rule
               END
               ORDER BY position
             )
      FROM jsonb_array_elements(abilities) WITH ORDINALITY AS item(rule, position)
    ),
    updated_at = now()
WHERE scope = 'institute'
  AND is_default = true
  AND name->>'en' = 'parent'
  AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(abilities) AS rule
        WHERE rule = '{"action":"read","subject":"Leave"}'::jsonb
      );
--> statement-breakpoint

-- 3. The default class teacher role only had rules for its sections' leaves, so a class
--    teacher could not file or read a leave of their own.
UPDATE roles
SET abilities = abilities
      || '[{"action":"create","subject":"Leave","conditions":{"userId":"$user.membershipId"}},{"action":"read","subject":"Leave","conditions":{"userId":"$user.membershipId"}}]'::jsonb,
    updated_at = now()
WHERE scope = 'institute'
  AND is_default = true
  AND name->>'en' = 'class_teacher'
  AND NOT abilities @> '[{"subject":"Leave","conditions":{"userId":"$user.membershipId"}}]'::jsonb;
