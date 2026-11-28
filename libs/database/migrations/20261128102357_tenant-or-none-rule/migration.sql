-- A reference to a table whose rows may belong to no institute (`tenant_id` NULL: a system
-- role, a platform sender, a person's file) cannot carry `tenant_id` in its foreign key. Two
-- trigger functions hold the rule instead: the referenced row belongs to the referencing
-- row's institute, or to none.
--
-- Both run as their owner. The rule holds for every role, and the role that writes a row may
-- not be allowed to read the row on the other side: an institute does not read a person's
-- file row, and only the platform reads another institute's rows. `search_path` is pinned so
-- that no caller can put another table in front of the real one. The owner must bypass row
-- security (a superuser does); where it does not, both functions refuse the statement.

-- On the referencing table. Arguments: the referencing column, the referenced table.
CREATE OR REPLACE FUNCTION public.check_same_tenant_or_none() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  reference uuid;
  own_tenant uuid;
  old_reference uuid;
  old_tenant uuid;
  referenced_tenant uuid;
BEGIN
  EXECUTE format('SELECT ($1).%I, ($1).tenant_id', TG_ARGV[0]) INTO reference, own_tenant USING NEW;
  IF reference IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    EXECUTE format('SELECT ($1).%I, ($1).tenant_id', TG_ARGV[0])
      INTO old_reference, old_tenant USING OLD;
    IF old_reference IS NOT DISTINCT FROM reference AND old_tenant IS NOT DISTINCT FROM own_tenant THEN
      RETURN NULL;
    END IF;
  END IF;
  -- A rule that cannot see every row would let anything through, so it refuses instead.
  IF row_security_active(TG_ARGV[1]::regclass) THEN
    RAISE EXCEPTION 'same-tenant rule "%" cannot read every row of "%": the owner of check_same_tenant_or_none() must bypass row security', TG_NAME, TG_ARGV[1]
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  -- The lock a foreign key takes: the referenced row cannot change institute before this
  -- transaction ends. The table is read, not its live view: a deleted row still has an owner.
  EXECUTE format('SELECT tenant_id FROM %s WHERE id = $1 FOR KEY SHARE', TG_ARGV[1]::regclass)
    INTO referenced_tenant USING reference;
  IF referenced_tenant IS NOT NULL AND referenced_tenant IS DISTINCT FROM own_tenant THEN
    RAISE EXCEPTION 'insert or update on table "%" violates same-tenant rule "%"', TG_TABLE_NAME, TG_NAME
      USING ERRCODE = 'foreign_key_violation',
            DETAIL = format('Key (%s) names a row of table "%s" that belongs to another tenant.',
                            TG_ARGV[0], TG_ARGV[1]),
            TABLE = TG_TABLE_NAME,
            COLUMN = TG_ARGV[0],
            CONSTRAINT = TG_NAME;
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint

-- On the referenced table: its `tenant_id` does not change to an institute while a row of
-- another institute references it. The referencing tables are read from the catalog: every
-- table with `tenant_id` that holds a one-column foreign key to this one.
CREATE OR REPLACE FUNCTION public.keep_referenced_tenant() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  item record;
  found boolean;
BEGIN
  IF NEW.tenant_id IS NULL OR NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id THEN
    RETURN NEW;
  END IF;
  -- Waits for every transaction that holds this row for a reference it is writing, so that
  -- the search below sees that reference.
  EXECUTE format('SELECT 1 FROM %s WHERE id = $1 FOR UPDATE', TG_RELID::regclass) USING OLD.id;
  FOR item IN
    SELECT con.conrelid::regclass AS referencing, att.attname AS reference
      FROM pg_constraint con
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
     WHERE con.contype = 'f' AND con.confrelid = TG_RELID AND cardinality(con.conkey) = 1
       AND con.conparentid = 0
       AND EXISTS (SELECT 1 FROM pg_attribute t
                    WHERE t.attrelid = con.conrelid AND t.attname = 'tenant_id'
                      AND NOT t.attisdropped)
  LOOP
    IF row_security_active(item.referencing) THEN
      RAISE EXCEPTION 'same-tenant rule "%" cannot read every row of "%": the owner of keep_referenced_tenant() must bypass row security', TG_NAME, item.referencing
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1 AND tenant_id IS DISTINCT FROM $2)',
      item.referencing, item.reference)
      INTO found USING OLD.id, NEW.tenant_id;
    IF found THEN
      RAISE EXCEPTION 'update on table "%" violates same-tenant rule "%"', TG_TABLE_NAME, TG_NAME
        USING ERRCODE = 'foreign_key_violation',
              DETAIL = format('The row is referenced from table "%s" (%s) by a row of another tenant.',
                              item.referencing, item.reference),
              TABLE = TG_TABLE_NAME,
              COLUMN = 'tenant_id',
              CONSTRAINT = TG_NAME;
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;
--> statement-breakpoint

-- Rows that already break the rule are reported, not changed: the migration stops and names
-- each key with its count.
DO $$
DECLARE
  item record;
  broken bigint;
  report text := '';
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      ('application_document_files', 'file_id', 'files'),
      ('export_reports', 'file_id', 'files'),
      ('institute_branding', 'cover_image_file_id', 'files'),
      ('institute_branding', 'favicon_file_id', 'files'),
      ('institute_branding', 'logo_file_id', 'files'),
      ('issued_certificates', 'pdf_file_id', 'files'),
      ('leave_files', 'file_id', 'files'),
      ('memberships', 'role_id', 'roles'),
      ('notification_deliveries', 'notification_id', 'notifications'),
      ('notification_deliveries', 'sender_id', 'messaging_senders'),
      ('staff_qualifications', 'certificate_file_id', 'files'),
      ('tc_register', 'pdf_file_id', 'files'),
      ('tenant_user_profiles', 'profile_image_file_id', 'files')
    ) AS key(referencing, reference, referenced)
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I child JOIN %I parent ON parent.id = child.%I
        WHERE parent.tenant_id IS NOT NULL AND parent.tenant_id IS DISTINCT FROM child.tenant_id',
      item.referencing, item.referenced, item.reference) INTO broken;
    IF broken > 0 THEN
      report := report || format(E'\n  %s.%s -> %s: %s row(s)',
                                 item.referencing, item.reference, item.referenced, broken);
    END IF;
  END LOOP;
  IF report <> '' THEN
    RAISE EXCEPTION 'Rows reference a row of another tenant; correct them before this migration:%', report;
  END IF;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "application_document_files_file_id_tenant_or_none" AFTER INSERT OR UPDATE ON "application_document_files" FOR EACH ROW EXECUTE FUNCTION check_same_tenant_or_none('file_id', 'files');
--> statement-breakpoint
CREATE TRIGGER "export_reports_file_id_tenant_or_none" AFTER INSERT OR UPDATE ON "export_reports" FOR EACH ROW EXECUTE FUNCTION check_same_tenant_or_none('file_id', 'files');
--> statement-breakpoint
CREATE TRIGGER "institute_branding_cover_image_file_id_tenant_or_none" AFTER INSERT OR UPDATE ON "institute_branding" FOR EACH ROW EXECUTE FUNCTION check_same_tenant_or_none('cover_image_file_id', 'files');
--> statement-breakpoint
CREATE TRIGGER "institute_branding_favicon_file_id_tenant_or_none" AFTER INSERT OR UPDATE ON "institute_branding" FOR EACH ROW EXECUTE FUNCTION check_same_tenant_or_none('favicon_file_id', 'files');
--> statement-breakpoint
CREATE TRIGGER "institute_branding_logo_file_id_tenant_or_none" AFTER INSERT OR UPDATE ON "institute_branding" FOR EACH ROW EXECUTE FUNCTION check_same_tenant_or_none('logo_file_id', 'files');
--> statement-breakpoint
CREATE TRIGGER "issued_certificates_pdf_file_id_tenant_or_none" AFTER INSERT OR UPDATE ON "issued_certificates" FOR EACH ROW EXECUTE FUNCTION check_same_tenant_or_none('pdf_file_id', 'files');
--> statement-breakpoint
CREATE TRIGGER "leave_files_file_id_tenant_or_none" AFTER INSERT OR UPDATE ON "leave_files" FOR EACH ROW EXECUTE FUNCTION check_same_tenant_or_none('file_id', 'files');
--> statement-breakpoint
CREATE TRIGGER "memberships_role_id_tenant_or_none" AFTER INSERT OR UPDATE ON "memberships" FOR EACH ROW EXECUTE FUNCTION check_same_tenant_or_none('role_id', 'roles');
--> statement-breakpoint
CREATE TRIGGER "notification_deliveries_notification_id_tenant_or_none" AFTER INSERT OR UPDATE ON "notification_deliveries" FOR EACH ROW EXECUTE FUNCTION check_same_tenant_or_none('notification_id', 'notifications');
--> statement-breakpoint
CREATE TRIGGER "notification_deliveries_sender_id_tenant_or_none" AFTER INSERT OR UPDATE ON "notification_deliveries" FOR EACH ROW EXECUTE FUNCTION check_same_tenant_or_none('sender_id', 'messaging_senders');
--> statement-breakpoint
CREATE TRIGGER "staff_qualifications_certificate_file_id_tenant_or_none" AFTER INSERT OR UPDATE ON "staff_qualifications" FOR EACH ROW EXECUTE FUNCTION check_same_tenant_or_none('certificate_file_id', 'files');
--> statement-breakpoint
CREATE TRIGGER "tc_register_pdf_file_id_tenant_or_none" AFTER INSERT OR UPDATE ON "tc_register" FOR EACH ROW EXECUTE FUNCTION check_same_tenant_or_none('pdf_file_id', 'files');
--> statement-breakpoint
CREATE TRIGGER "tenant_user_profiles_profile_image_file_id_tenant_or_none" AFTER INSERT OR UPDATE ON "tenant_user_profiles" FOR EACH ROW EXECUTE FUNCTION check_same_tenant_or_none('profile_image_file_id', 'files');
--> statement-breakpoint
CREATE TRIGGER "files_keep_referenced_tenant" BEFORE UPDATE ON "files" FOR EACH ROW WHEN (OLD.tenant_id IS DISTINCT FROM NEW.tenant_id) EXECUTE FUNCTION keep_referenced_tenant();
--> statement-breakpoint
CREATE TRIGGER "messaging_senders_keep_referenced_tenant" BEFORE UPDATE ON "messaging_senders" FOR EACH ROW WHEN (OLD.tenant_id IS DISTINCT FROM NEW.tenant_id) EXECUTE FUNCTION keep_referenced_tenant();
--> statement-breakpoint
CREATE TRIGGER "notifications_keep_referenced_tenant" BEFORE UPDATE ON "notifications" FOR EACH ROW WHEN (OLD.tenant_id IS DISTINCT FROM NEW.tenant_id) EXECUTE FUNCTION keep_referenced_tenant();
--> statement-breakpoint
CREATE TRIGGER "roles_keep_referenced_tenant" BEFORE UPDATE ON "roles" FOR EACH ROW WHEN (OLD.tenant_id IS DISTINCT FROM NEW.tenant_id) EXECUTE FUNCTION keep_referenced_tenant();
