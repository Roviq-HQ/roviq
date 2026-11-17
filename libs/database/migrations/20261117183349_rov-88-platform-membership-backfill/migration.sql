-- ROV-88: move platform-role memberships out of the institute `memberships`
-- table into `platform_memberships`. Rows that predate the three-table split
-- held the platform admin as an institute membership. No-op on a fresh database.

INSERT INTO platform_memberships (user_id, role_id, abilities, is_active, created_by, updated_by)
SELECT DISTINCT ON (m.user_id)
  m.user_id, m.role_id, m.abilities, m.status = 'ACTIVE', m.created_by, m.updated_by
FROM memberships m
JOIN roles r ON r.id = m.role_id
WHERE r.scope = 'platform' AND m.deleted_at IS NULL
ORDER BY m.user_id, (m.status = 'ACTIVE') DESC, m.created_at
ON CONFLICT (user_id) WHERE deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

DELETE FROM memberships m
USING roles r
WHERE r.id = m.role_id AND r.scope = 'platform';
