-- ROV-91: give every existing reseller its own copy of the reseller system roles.
-- Resellers created before this change shared the system reseller's role rows.
-- New resellers get their copies from provisionResellerSystemRoles(); this only
-- repairs rows that predate it. No-op on a fresh database.

INSERT INTO roles (scope, reseller_id, name, abilities, primary_nav_slugs, is_default, is_system, status, created_by, updated_by)
SELECT 'reseller', r.id, t.name, t.abilities, t.primary_nav_slugs, t.is_default, t.is_system, t.status, t.created_by, t.updated_by
FROM resellers r
JOIN resellers sys ON sys.is_system
JOIN roles t ON t.reseller_id = sys.id AND t.scope = 'reseller' AND t.is_system AND t.deleted_at IS NULL
WHERE NOT r.is_system
ON CONFLICT (reseller_id, name) WHERE scope = 'reseller' AND deleted_at IS NULL DO NOTHING;
--> statement-breakpoint

UPDATE reseller_memberships rm
SET role_id = own.id, updated_at = now()
FROM roles shared, roles own
WHERE rm.role_id = shared.id
  AND shared.scope = 'reseller'
  AND shared.reseller_id <> rm.reseller_id
  AND own.scope = 'reseller'
  AND own.reseller_id = rm.reseller_id
  AND own.name = shared.name
  AND own.deleted_at IS NULL;
