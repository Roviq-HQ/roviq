-- ROV-186: a reseller edits its own profile and branding from the reseller portal.

-- ── 1. Row rule: only its own record ──────────────────────────────────────────────
CREATE POLICY "reseller_own_update" ON "resellers" AS PERMISSIVE FOR UPDATE TO "roviq_reseller" USING (id = current_setting('app.current_reseller_id', true)::uuid) WITH CHECK (id = current_setting('app.current_reseller_id', true)::uuid);
--> statement-breakpoint

-- ── 2. Column rule: only what the settings pages edit ─────────────────────────────
-- slug, tier, status, is_system, is_active, suspended_at, custom_domain and the
-- delete columns stay platform-only: roviq_reseller has no UPDATE right on them.
GRANT UPDATE (name, branding, registration_number, registration_state, contact, address,
              updated_at, updated_by, version)
  ON resellers TO roviq_reseller;
--> statement-breakpoint

-- ── 3. Ability on every stored copy of the full admin role ────────────────────────
-- New copies get it from RESELLER_SYSTEM_ROLE_ABILITIES. The other two roles read
-- through `read all`.
UPDATE roles
   SET abilities = abilities || '[{"action": "read", "subject": "Reseller"}, {"action": "update", "subject": "Reseller"}]'::jsonb,
       updated_at = now()
 WHERE scope = 'reseller'
   AND is_system
   AND name->>'en' = 'reseller_full_admin'
   AND NOT abilities @> '[{"action": "update", "subject": "Reseller"}]'::jsonb;
