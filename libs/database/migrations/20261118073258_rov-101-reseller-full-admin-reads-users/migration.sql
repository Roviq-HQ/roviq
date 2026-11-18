-- ROV-101: reseller_full_admin may impersonate institute users but could not list them
-- (resellerListUsers needs `read User`). Each reseller owns a copy of the role, so add
-- the grant to every stored copy that lacks it; new copies get it from the code.
UPDATE roles
   SET abilities = abilities || '[{"action": "read", "subject": "User"}]'::jsonb,
       updated_at = now()
 WHERE scope = 'reseller'
   AND is_system
   AND name->>'en' = 'reseller_full_admin'
   AND NOT abilities @> '[{"action": "read", "subject": "User"}]'::jsonb;
