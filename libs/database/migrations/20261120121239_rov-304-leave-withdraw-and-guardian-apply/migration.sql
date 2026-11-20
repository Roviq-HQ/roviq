-- ROV-304, decisions of 2026-11-20: an applicant may withdraw their own pending leave, and a
-- guardian may file and withdraw leaves for their linked children.
-- Default roles only; no-op on a fresh database (the seed writes the current defaults).

-- 1. Roles that file their own leaves may withdraw them while pending.
UPDATE roles
SET abilities = abilities
      || '[{"action":"withdraw","subject":"Leave","conditions":{"userId":"$user.membershipId","status":"PENDING"}}]'::jsonb,
    updated_at = now()
WHERE scope = 'institute'
  AND is_default = true
  AND name->>'en' IN ('student', 'subject_teacher', 'class_teacher')
  AND abilities @> '[{"action":"create","subject":"Leave","conditions":{"userId":"$user.membershipId"}}]'::jsonb
  AND NOT abilities @> '[{"action":"withdraw","subject":"Leave"}]'::jsonb;
--> statement-breakpoint

-- 2. Guardians file leaves for their children and withdraw them while pending.
UPDATE roles
SET abilities = abilities
      || '[{"action":"create","subject":"Leave","conditions":{"studentProfileId":{"$in":"$user.linkedStudentIds"}}},{"action":"withdraw","subject":"Leave","conditions":{"studentProfileId":{"$in":"$user.linkedStudentIds"},"status":"PENDING"}}]'::jsonb,
    updated_at = now()
WHERE scope = 'institute'
  AND is_default = true
  AND name->>'en' = 'parent'
  AND NOT abilities @> '[{"action":"withdraw","subject":"Leave"}]'::jsonb;
