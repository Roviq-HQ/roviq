-- ROV-290: institute_admin no longer manages institute groups or platform-level
-- Institute actions. Default roles created before this change still hold the bare
-- manage-all rule; roles a tenant has customised are left alone.
-- No-op on a fresh database (the seed writes the current default).

UPDATE roles
SET abilities = '[{"action":"manage","subject":"all"},{"action":"manage","subject":"InstituteGroup","inverted":true},{"action":"read","subject":"InstituteGroup"},{"action":"create","subject":"Institute","inverted":true},{"action":"update","subject":"Institute","inverted":true},{"action":"delete","subject":"Institute","inverted":true},{"action":"restore","subject":"Institute","inverted":true},{"action":"approve","subject":"Institute","inverted":true},{"action":"reject","subject":"Institute","inverted":true},{"action":"activate","subject":"Institute","inverted":true},{"action":"deactivate","subject":"Institute","inverted":true},{"action":"suspend","subject":"Institute","inverted":true},{"action":"view_statistics","subject":"Institute","inverted":true}]'::jsonb,
    updated_at = now()
WHERE scope = 'institute'
  AND is_default = true
  AND deleted_at IS NULL
  AND name->>'en' = 'institute_admin'
  AND abilities = '[{"action":"manage","subject":"all"}]'::jsonb;
