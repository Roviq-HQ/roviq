-- Refresh source-owned roles without changing custom roles or admin_clerk permissions.
WITH policies(role_key, denial) AS (
  VALUES
    ('principal', '[{"action":"read","subject":"Student","fields":["annual_income","annualIncome","counselorNotes","medicalInfo"],"inverted":true}]'::jsonb),
    ('vice_principal', '[{"action":"read","subject":"Student","fields":["aadhaar","pan","annual_income","annualIncome","counselorNotes","medicalInfo"],"inverted":true}]'::jsonb),
    ('academic_coordinator', '[{"action":"read","subject":"Student","fields":["aadhaar","pan","annual_income","annualIncome","counselorNotes","medicalInfo"],"inverted":true}]'::jsonb),
    ('accountant', '[{"action":"read","subject":"Student","fields":["aadhaar","pan","annual_income","annualIncome","counselorNotes","medicalInfo"],"inverted":true}]'::jsonb),
    ('class_teacher', '[{"action":"read","subject":"Student","fields":["aadhaar","pan","annual_income","annualIncome","counselorNotes","medicalInfo"],"inverted":true}]'::jsonb),
    ('subject_teacher', '[{"action":"read","subject":"Student","fields":["aadhaar","pan","annual_income","annualIncome","counselorNotes","medicalInfo"],"inverted":true}]'::jsonb),
    ('activity_teacher', '[{"action":"read","subject":"Student","fields":["aadhaar","pan","annual_income","annualIncome","counselorNotes","medicalInfo"],"inverted":true}]'::jsonb),
    ('lab_assistant', '[{"action":"read","subject":"Student","fields":["aadhaar","pan","annual_income","annualIncome","counselorNotes","medicalInfo"],"inverted":true}]'::jsonb),
    ('librarian', '[{"action":"read","subject":"Student","fields":["aadhaar","pan","annual_income","annualIncome","counselorNotes","medicalInfo"],"inverted":true}]'::jsonb),
    ('transport_incharge', '[{"action":"read","subject":"Student","fields":["aadhaar","pan","annual_income","annualIncome","counselorNotes","medicalInfo"],"inverted":true}]'::jsonb),
    ('hostel_warden', '[{"action":"read","subject":"Student","fields":["aadhaar","pan","annual_income","annualIncome","counselorNotes","medicalInfo"],"inverted":true}]'::jsonb),
    ('counselor', '[{"action":"read","subject":"Student","fields":["aadhaar","pan","annual_income","annualIncome"],"inverted":true}]'::jsonb),
    ('sports_coach', '[{"action":"read","subject":"Student","fields":["aadhaar","pan","annual_income","annualIncome","counselorNotes","medicalInfo"],"inverted":true}]'::jsonb),
    ('it_admin', '[{"action":"read","subject":"Student","fields":["aadhaar","pan","annual_income","annualIncome","counselorNotes","medicalInfo"],"inverted":true}]'::jsonb),
    ('receptionist', '[{"action":"read","subject":"Student","fields":["aadhaar","pan","annual_income","annualIncome","counselorNotes","medicalInfo"],"inverted":true}]'::jsonb),
    ('exam_coordinator', '[{"action":"read","subject":"Student","fields":["aadhaar","pan","annual_income","annualIncome","counselorNotes","medicalInfo"],"inverted":true}]'::jsonb),
    ('nurse', '[{"action":"read","subject":"Student","fields":["aadhaar","pan","annual_income","annualIncome","counselorNotes"],"inverted":true}]'::jsonb),
    ('support_staff', '[{"action":"read","subject":"Student","fields":["aadhaar","pan","annual_income","annualIncome","counselorNotes","medicalInfo"],"inverted":true}]'::jsonb),
    ('student', '[{"action":"read","subject":"Student","fields":["aadhaar","pan","annual_income","annualIncome","counselorNotes","medicalInfo"],"inverted":true}]'::jsonb),
    ('parent', '[{"action":"read","subject":"Student","fields":["aadhaar","pan","annual_income","annualIncome","counselorNotes","medicalInfo"],"inverted":true}]'::jsonb)
), scoped AS (
  SELECT r.id, p.denial,
    CASE WHEN p.role_key = 'parent' THEN (
      SELECT jsonb_agg(
        CASE WHEN rule->>'subject' = 'Student'
          AND rule->>'action' = 'read'
          AND COALESCE((rule->>'inverted')::boolean, false) = false
        THEN jsonb_set(rule, '{conditions}', '{"id":{"$in":"$user.linkedStudentIds"}}'::jsonb)
        ELSE rule END ORDER BY ordinal
      ) FROM jsonb_array_elements(r.abilities) WITH ORDINALITY AS entries(rule, ordinal)
    ) ELSE r.abilities END AS base
  FROM roles r JOIN policies p ON r.name->>'en' = p.role_key
  WHERE r.scope = 'institute' AND r.is_default = true AND r.deleted_at IS NULL
), refreshed AS (
  SELECT id, CASE WHEN base @> denial THEN base ELSE base || denial END AS abilities
  FROM scoped
)
UPDATE roles r SET abilities = refreshed.abilities, version = r.version + 1, updated_at = NOW()
FROM refreshed WHERE r.id = refreshed.id AND r.abilities IS DISTINCT FROM refreshed.abilities;
