-- Everything the generated baseline cannot express: the system reseller row, functions,
-- the partitioned audit_logs, indexes outside the Drizzle schema, triggers, FORCE ROW LEVEL
-- SECURITY and the privileges of the three application roles.

-- 1. System reseller
-- institutes.reseller_id defaults to this row, so it must exist before any institute.
INSERT INTO resellers (id, name, slug, is_system, tier, status, created_by, updated_by)
VALUES (
  '00000000-0000-7000-a000-000000000011', 'Roviq Direct', 'roviq-direct', true,
  'FULL_MANAGEMENT', 'ACTIVE',
  '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000'
);
--> statement-breakpoint

-- 2. Functions
-- Trigger functions, partition maintenance, tenant sequences and the public TC check.
CREATE FUNCTION public.audit_logs_check_subject_tenant() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.subject_tenant_id IS NOT NULL AND NEW.scope = 'reseller' AND NOT EXISTS (
    SELECT 1 FROM institutes i
    WHERE i.id = NEW.subject_tenant_id AND i.reseller_id = NEW.reseller_id
  ) THEN
    NEW.subject_tenant_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.detach_monthly_partition(parent regclass, partition_name text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  child regclass;
BEGIN
  SELECT c.oid::regclass
    INTO child
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
   WHERE i.inhparent = parent
     AND c.relname = partition_name;

  IF child IS NULL THEN
    RAISE EXCEPTION '% is not a partition of %', partition_name, parent::text;
  END IF;

  PERFORM lock_down_partitions(parent);
  EXECUTE format('ALTER TABLE %s DETACH PARTITION %s', parent, child);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.ensure_monthly_partition(parent regclass, month_start timestamp with time zone) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  truncated_start timestamptz := date_trunc('month', month_start);
  truncated_end   timestamptz := date_trunc('month', month_start) + interval '1 month';
  parent_name     text := parent::text;
  partition_name  text := parent_name || to_char(truncated_start, '_YYYY_MM');
  is_partitioned  boolean;
BEGIN
  SELECT (relkind = 'p' AND
          (SELECT partstrat FROM pg_partitioned_table WHERE partrelid = parent) = 'r')
    INTO is_partitioned
    FROM pg_class WHERE oid = parent;

  IF NOT is_partitioned THEN
    RAISE EXCEPTION '% is not a RANGE-partitioned table', parent_name;
  END IF;

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF %s FOR VALUES FROM (%L) TO (%L)',
    partition_name, parent_name, truncated_start, truncated_end
  );

  PERFORM lock_down_partitions(parent);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.guard_impersonation_session() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  entitled boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.impersonator_scope = 'reseller' THEN
      SELECT EXISTS (
        SELECT 1 FROM reseller_memberships m
          JOIN resellers r ON r.id = m.reseller_id
          JOIN institutes i ON i.reseller_id = r.id
         WHERE m.user_id = NEW.impersonator_id AND m.is_active AND m.deleted_at IS NULL
           AND r.status = 'ACTIVE' AND r.is_active AND r.deleted_at IS NULL
           AND i.id = NEW.target_tenant_id
      ) INTO entitled;
    ELSIF NEW.impersonator_scope = 'platform' THEN
      SELECT EXISTS (
        SELECT 1 FROM platform_memberships m
         WHERE m.user_id = NEW.impersonator_id AND m.is_active AND m.deleted_at IS NULL
      ) INTO entitled;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM memberships m
         WHERE m.user_id = NEW.impersonator_id AND m.tenant_id = NEW.target_tenant_id
           AND m.status = 'ACTIVE' AND m.deleted_at IS NULL
      ) INTO entitled;
    END IF;
    IF NOT entitled THEN
      RAISE EXCEPTION 'impersonation refused: % has no active % access to institute %',
        NEW.impersonator_id, NEW.impersonator_scope, NEW.target_tenant_id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'an ended impersonation session cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.impersonator_id IS DISTINCT FROM OLD.impersonator_id
     OR NEW.impersonator_scope IS DISTINCT FROM OLD.impersonator_scope
     OR NEW.target_user_id IS DISTINCT FROM OLD.target_user_id
     OR NEW.target_tenant_id IS DISTINCT FROM OLD.target_tenant_id
     OR NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.expires_at > OLD.expires_at THEN
    RAISE EXCEPTION 'an impersonation session cannot be re-pointed or extended' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.guard_refresh_token() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  live boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.membership_scope = 'reseller' THEN
      SELECT EXISTS (
        SELECT 1 FROM reseller_memberships m
          JOIN resellers r ON r.id = m.reseller_id
         WHERE m.id = NEW.membership_id AND m.user_id = NEW.user_id
           AND m.is_active AND m.deleted_at IS NULL
           AND r.status = 'ACTIVE' AND r.is_active AND r.deleted_at IS NULL
      ) INTO live;
    ELSIF NEW.membership_scope = 'platform' THEN
      SELECT EXISTS (
        SELECT 1 FROM platform_memberships m
         WHERE m.id = NEW.membership_id AND m.user_id = NEW.user_id
           AND m.is_active AND m.deleted_at IS NULL
      ) INTO live;
    ELSIF NEW.membership_scope = 'institute' THEN
      SELECT EXISTS (
        SELECT 1 FROM memberships m
         WHERE m.id = NEW.membership_id AND m.user_id = NEW.user_id
           AND m.tenant_id = NEW.tenant_id
           AND m.status = 'ACTIVE' AND m.deleted_at IS NULL
      ) INTO live;
    ELSE
      -- An unknown scope is refused by chk_refresh_token_membership_scope.
      RETURN NEW;
    END IF;
    IF NOT live THEN
      RAISE EXCEPTION 'refresh token refused: no active % membership %', NEW.membership_scope, NEW.membership_id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.membership_id IS DISTINCT FROM OLD.membership_id
     OR NEW.membership_scope IS DISTINCT FROM OLD.membership_scope
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.expires_at > OLD.expires_at THEN
    RAISE EXCEPTION 'a refresh token cannot be re-pointed or extended' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND (
    NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
    OR NEW.revoked_reason IS DISTINCT FROM OLD.revoked_reason
  ) THEN
    RAISE EXCEPTION 'a revoked refresh token stays revoked' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.institutes_delete_admin_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF current_user <> 'roviq_admin'
     AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'only the platform can delete or restore an institute'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.lock_down_partitions(parent regclass) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  part    record;
  grantee text;
BEGIN
  FOR part IN
    SELECT c.oid::regclass AS rel, c.relowner, c.relacl,
           (c.relrowsecurity AND c.relforcerowsecurity) AS sealed
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
     WHERE i.inhparent = parent
  LOOP
    FOR grantee IN
      SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                           ELSE format('%I', pg_get_userbyid(a.grantee)) END
        FROM aclexplode(part.relacl) a
       WHERE a.grantee <> part.relowner
    LOOP
      EXECUTE format('REVOKE ALL ON %s FROM %s', part.rel, grantee);
    END LOOP;

    -- Guarded: ALTER TABLE takes ACCESS EXCLUSIVE, and this runs daily.
    IF NOT part.sealed THEN
      EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', part.rel);
      EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', part.rel);
    END IF;
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.next_sequence_value(p_tenant_id uuid, p_sequence_name character varying) RETURNS TABLE(next_val bigint, formatted character varying)
    LANGUAGE sql
    AS $$
WITH updated AS (
  UPDATE tenant_sequences
  SET current_value = current_value + 1
  WHERE tenant_id = p_tenant_id AND sequence_name = p_sequence_name
  RETURNING current_value, format_template, COALESCE(prefix, '') AS prefix
)
SELECT
  current_value AS next_val,
  REPLACE(
    regexp_replace(
      format_template,
      '\{value:(\d+)d\}',
      LPAD(
        current_value::text,
        COALESCE((regexp_match(format_template, '\{value:(\d+)d\}'))[1]::int, 4),
        '0'
      )
    ),
    '{prefix}', prefix
  )::varchar AS formatted
FROM updated;
$$;
--> statement-breakpoint
CREATE FUNCTION public.protect_system_reseller() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN
      RAISE EXCEPTION 'the system reseller cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.is_system AND (
    NEW.is_system IS DISTINCT FROM OLD.is_system
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.is_active IS DISTINCT FROM OLD.is_active
    OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
  ) THEN
    RAISE EXCEPTION 'the system reseller cannot be suspended, deactivated or deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.refresh_section_strength(p_section_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF p_section_id IS NULL THEN
    RETURN;
  END IF;
  -- Row lock first: a concurrent writer waits here and then counts our committed row too.
  -- NO KEY UPDATE, because the insert's foreign-key check already holds KEY SHARE on this row;
  -- two inserts asking for a full UPDATE lock would deadlock on each other's key share.
  PERFORM 1 FROM sections WHERE id = p_section_id FOR NO KEY UPDATE;
  UPDATE sections s
  SET current_strength = (
    SELECT count(*)
    FROM student_academics sa
    JOIN student_profiles sp ON sp.id = sa.student_profile_id
    WHERE sa.section_id = p_section_id
      AND sa.deleted_at IS NULL
      AND sp.deleted_at IS NULL
      AND sp.academic_status = 'ENROLLED'
  )
  WHERE s.id = p_section_id;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.refresh_section_strengths(p_section_ids uuid[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_section uuid;
BEGIN
  -- Ascending order, so two statements touching the same sections cannot deadlock.
  FOR v_section IN
    SELECT DISTINCT s FROM unnest(p_section_ids) AS s WHERE s IS NOT NULL ORDER BY s
  LOOP
    PERFORM refresh_section_strength(v_section);
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.revoke_reseller_member_sessions() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE refresh_tokens
     SET revoked_at = now(), revoked_reason = 'admin_revoked',
         updated_at = now(), updated_by = NEW.updated_by
   WHERE membership_scope = 'reseller'
     AND revoked_at IS NULL
     AND membership_id = NEW.id;

  UPDATE impersonation_sessions
     SET ended_at = now(), ended_reason = 'revoked'
   WHERE impersonator_scope = 'reseller'
     AND ended_at IS NULL
     AND impersonator_id = NEW.user_id
     AND target_tenant_id IN (SELECT id FROM institutes WHERE reseller_id = NEW.reseller_id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.revoke_reseller_sessions() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE refresh_tokens
     SET revoked_at = now(), revoked_reason = 'admin_revoked',
         updated_at = now(), updated_by = NEW.updated_by
   WHERE membership_scope = 'reseller'
     AND revoked_at IS NULL
     AND membership_id IN (SELECT id FROM reseller_memberships WHERE reseller_id = NEW.id);

  UPDATE impersonation_sessions
     SET ended_at = now(), ended_reason = 'revoked'
   WHERE impersonator_scope = 'reseller'
     AND ended_at IS NULL
     AND impersonator_id IN (SELECT user_id FROM reseller_memberships WHERE reseller_id = NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.revoke_sessions_on_password_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE refresh_tokens
     SET revoked_at = now(), revoked_reason = 'password_change',
         updated_at = now(), updated_by = NEW.updated_by
   WHERE user_id = NEW.id AND revoked_at IS NULL;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.trg_student_academics_section_strength() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_sections uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT section_id) INTO v_sections FROM new_rows;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT section_id) INTO v_sections FROM old_rows;
  ELSE
    SELECT array_agg(DISTINCT s) INTO v_sections
    FROM old_rows o
    JOIN new_rows n ON n.id = o.id
    CROSS JOIN LATERAL unnest(ARRAY[o.section_id, n.section_id]) AS s
    WHERE o.section_id IS DISTINCT FROM n.section_id
       OR o.deleted_at IS DISTINCT FROM n.deleted_at
       OR o.student_profile_id IS DISTINCT FROM n.student_profile_id;
  END IF;
  PERFORM refresh_section_strengths(v_sections);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.trg_student_profiles_section_strength() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_sections uuid[];
BEGIN
  SELECT array_agg(DISTINCT sa.section_id) INTO v_sections
  FROM old_rows o
  JOIN new_rows n ON n.id = o.id
  JOIN student_academics sa ON sa.student_profile_id = n.id AND sa.deleted_at IS NULL
  WHERE o.academic_status IS DISTINCT FROM n.academic_status
     OR o.deleted_at IS DISTINCT FROM n.deleted_at;
  PERFORM refresh_section_strengths(v_sections);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.verify_tc(p_token text) RETURNS TABLE(serial_number character varying, status public."TcStatus", student_name text, institute_name jsonb, issued_on date, is_duplicate boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT t.tc_serial_number,
         t.status,
         t.tc_data ->> 'studentName',
         i.name,
         (t.issued_at AT TIME ZONE 'Asia/Kolkata')::date,
         t.is_duplicate
  FROM tc_register t
  JOIN institutes i ON i.id = t.tenant_id
  WHERE t.verification_token = p_token
    AND length(p_token) >= 32
    AND t.deleted_at IS NULL
    AND i.deleted_at IS NULL
$$;
--> statement-breakpoint
CREATE FUNCTION public.year_rollover_section_map_check_sections() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sections s
    WHERE s.id = NEW.from_section_id AND s.tenant_id = NEW.tenant_id
  ) OR NOT EXISTS (
    SELECT 1 FROM sections s
    WHERE s.id = NEW.to_section_id AND s.tenant_id = NEW.tenant_id
      AND s.academic_year_id = NEW.academic_year_id
  ) THEN
    RAISE EXCEPTION 'year_rollover_section_map: both sections must be of the row''s institute and the target section of its year'
      USING ERRCODE = '23514', CONSTRAINT = 'year_rollover_section_map_sections_check';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- 2b. Function privileges
-- EXECUTE is granted to PUBLIC by default; these are callable only by the roles named here.
REVOKE ALL ON FUNCTION public.detach_monthly_partition(parent regclass, partition_name text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.detach_monthly_partition(parent regclass, partition_name text) TO roviq_admin;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ensure_monthly_partition(parent regclass, month_start timestamp with time zone) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.ensure_monthly_partition(parent regclass, month_start timestamp with time zone) TO roviq_admin;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lock_down_partitions(parent regclass) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.next_sequence_value(p_tenant_id uuid, p_sequence_name character varying) TO roviq_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.next_sequence_value(p_tenant_id uuid, p_sequence_name character varying) TO roviq_reseller;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.next_sequence_value(p_tenant_id uuid, p_sequence_name character varying) TO roviq_admin;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.refresh_section_strength(p_section_id uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.refresh_section_strengths(p_section_ids uuid[]) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.verify_tc(p_token text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.verify_tc(p_token text) TO roviq_admin;
--> statement-breakpoint

-- 3. audit_logs as a table partitioned by month
-- PostgreSQL cannot turn an existing table into a partitioned one, so the generated table is
-- replaced by a partitioned copy. LIKE copies columns, defaults, CHECKs and the primary key,
-- but not foreign keys, row security or policies. The primary key is renamed first so the
-- copy can take the name audit_logs_pkey.
ALTER TABLE audit_logs RENAME TO audit_logs_old;
--> statement-breakpoint
ALTER TABLE audit_logs_old RENAME CONSTRAINT audit_logs_pkey TO audit_logs_old_pkey;
--> statement-breakpoint
CREATE TABLE audit_logs (LIKE audit_logs_old INCLUDING ALL) PARTITION BY RANGE (created_at);
--> statement-breakpoint
DROP TABLE audit_logs_old;
--> statement-breakpoint
ALTER TABLE public.audit_logs
    ADD CONSTRAINT audit_logs_actor_id_users_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);
--> statement-breakpoint
ALTER TABLE public.audit_logs
    ADD CONSTRAINT audit_logs_impersonation_session_id_fkey FOREIGN KEY (impersonation_session_id) REFERENCES public.impersonation_sessions(id);
--> statement-breakpoint
ALTER TABLE public.audit_logs
    ADD CONSTRAINT audit_logs_impersonator_id_users_id_fkey FOREIGN KEY (impersonator_id) REFERENCES public.users(id);
--> statement-breakpoint
ALTER TABLE public.audit_logs
    ADD CONSTRAINT audit_logs_reseller_id_resellers_id_fkey FOREIGN KEY (reseller_id) REFERENCES public.resellers(id);
--> statement-breakpoint
ALTER TABLE public.audit_logs
    ADD CONSTRAINT audit_logs_tenant_id_institutes_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.institutes(id);
--> statement-breakpoint
ALTER TABLE public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_users_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);
--> statement-breakpoint
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_admin_all ON public.audit_logs TO roviq_admin USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY audit_app_insert ON public.audit_logs FOR INSERT TO roviq_app WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY audit_app_read ON public.audit_logs FOR SELECT TO roviq_app USING (((((scope)::text = 'institute'::text) AND (tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)) OR (subject_tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid)));
--> statement-breakpoint
CREATE POLICY audit_reseller_insert ON public.audit_logs FOR INSERT TO roviq_reseller WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY audit_reseller_read ON public.audit_logs FOR SELECT TO roviq_reseller USING (((((scope)::text = 'institute'::text) AND (tenant_id IN ( SELECT institutes.id
   FROM public.institutes
  WHERE (institutes.reseller_id = (current_setting('app.current_reseller_id'::text, true))::uuid)))) OR (((scope)::text = 'reseller'::text) AND (reseller_id = (current_setting('app.current_reseller_id'::text, true))::uuid))));
--> statement-breakpoint
-- Indexes of a partitioned table live here, not in the Drizzle schema.
CREATE INDEX idx_audit_correlation ON public.audit_logs USING btree (correlation_id);
--> statement-breakpoint
CREATE INDEX idx_audit_platform ON public.audit_logs USING btree (created_at DESC) WHERE ((scope)::text = 'platform'::text);
--> statement-breakpoint
CREATE INDEX idx_audit_reseller ON public.audit_logs USING btree (reseller_id, created_at DESC) WHERE (reseller_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX audit_logs_subject_tenant_idx ON public.audit_logs USING btree (subject_tenant_id, created_at) WHERE (subject_tenant_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX audit_logs_synthetic_origin_idx ON public.audit_logs USING btree (synthetic_origin) WHERE (synthetic_origin IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_audit_action_type ON public.audit_logs USING btree (tenant_id, action_type, created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_audit_entity ON public.audit_logs USING btree (tenant_id, entity_type, entity_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_audit_impersonation ON public.audit_logs USING btree (tenant_id, impersonator_id) WHERE (impersonator_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_audit_user ON public.audit_logs USING btree (tenant_id, user_id, created_at DESC);
--> statement-breakpoint

-- 4. Indexes and foreign keys the Drizzle schema does not declare
-- Carried over from the migrations this baseline replaces, so the database is unchanged.
CREATE INDEX idx_institutes_code_trgm ON public.institutes USING gin (COALESCE(code, ''::character varying) public.gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX idx_institutes_search ON public.institutes USING gin (to_tsvector('english'::regconfig, COALESCE((name ->> 'en'::text), ''::text)));
--> statement-breakpoint
CREATE INDEX idx_invoices_reseller ON public.invoices USING btree (reseller_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_invoices_status ON public.invoices USING btree (status) WHERE (status = ANY (ARRAY['SENT'::public."InvoiceStatus", 'OVERDUE'::public."InvoiceStatus"]));
--> statement-breakpoint
CREATE INDEX idx_invoices_tenant ON public.invoices USING btree (tenant_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_payments_gateway ON public.payments USING btree (gateway_payment_id) WHERE (gateway_payment_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_payments_invoice ON public.payments USING btree (invoice_id);
--> statement-breakpoint
CREATE INDEX idx_subscriptions_reseller ON public.subscriptions USING btree (reseller_id, status);
--> statement-breakpoint
CREATE INDEX idx_subscriptions_tenant ON public.subscriptions USING btree (tenant_id);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_gwc_default ON public.payment_gateway_configs USING btree (reseller_id, provider) WHERE ((is_default = true) AND (deleted_at IS NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX uq_invoice_number_reseller ON public.invoices USING btree (reseller_id, invoice_number);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_plan_code_reseller ON public.plans USING btree (reseller_id, code) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_sub_active_tenant ON public.subscriptions USING btree (tenant_id) WHERE (status = ANY (ARRAY['TRIALING'::public."SubscriptionStatus", 'ACTIVE'::public."SubscriptionStatus", 'PAUSED'::public."SubscriptionStatus", 'PAST_DUE'::public."SubscriptionStatus"]));
--> statement-breakpoint
ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);
--> statement-breakpoint
ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id);
--> statement-breakpoint

-- 5. Triggers
CREATE TRIGGER impersonation_sessions_guard BEFORE INSERT OR UPDATE ON public.impersonation_sessions FOR EACH ROW EXECUTE FUNCTION public.guard_impersonation_session();
--> statement-breakpoint
CREATE TRIGGER institutes_delete_admin_only_delete BEFORE DELETE ON public.institutes FOR EACH ROW EXECUTE FUNCTION public.institutes_delete_admin_only();
--> statement-breakpoint
CREATE TRIGGER institutes_delete_admin_only_update BEFORE UPDATE OF deleted_at ON public.institutes FOR EACH ROW WHEN ((old.deleted_at IS DISTINCT FROM new.deleted_at)) EXECUTE FUNCTION public.institutes_delete_admin_only();
--> statement-breakpoint
CREATE TRIGGER refresh_tokens_guard BEFORE INSERT OR UPDATE ON public.refresh_tokens FOR EACH ROW EXECUTE FUNCTION public.guard_refresh_token();
--> statement-breakpoint
CREATE TRIGGER reseller_memberships_revoke_sessions AFTER UPDATE OF is_active, deleted_at ON public.reseller_memberships FOR EACH ROW WHEN (((old.is_active AND (NOT new.is_active)) OR ((old.deleted_at IS NULL) AND (new.deleted_at IS NOT NULL)))) EXECUTE FUNCTION public.revoke_reseller_member_sessions();
--> statement-breakpoint
CREATE TRIGGER resellers_protect_system BEFORE DELETE OR UPDATE ON public.resellers FOR EACH ROW EXECUTE FUNCTION public.protect_system_reseller();
--> statement-breakpoint
CREATE TRIGGER resellers_revoke_sessions AFTER UPDATE OF status ON public.resellers FOR EACH ROW WHEN (((old.status = 'ACTIVE'::public."ResellerStatus") AND (new.status <> 'ACTIVE'::public."ResellerStatus"))) EXECUTE FUNCTION public.revoke_reseller_sessions();
--> statement-breakpoint
CREATE TRIGGER student_academics_section_strength_delete AFTER DELETE ON public.student_academics REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trg_student_academics_section_strength();
--> statement-breakpoint
CREATE TRIGGER student_academics_section_strength_insert AFTER INSERT ON public.student_academics REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trg_student_academics_section_strength();
--> statement-breakpoint
CREATE TRIGGER student_academics_section_strength_update AFTER UPDATE ON public.student_academics REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trg_student_academics_section_strength();
--> statement-breakpoint
CREATE TRIGGER student_profiles_section_strength_update AFTER UPDATE ON public.student_profiles REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.trg_student_profiles_section_strength();
--> statement-breakpoint
CREATE TRIGGER trg_audit_logs_check_subject_tenant BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.audit_logs_check_subject_tenant();
--> statement-breakpoint
CREATE TRIGGER trg_year_rollover_section_map_check_sections BEFORE INSERT OR UPDATE OF tenant_id, academic_year_id, from_section_id, to_section_id ON public.year_rollover_section_map FOR EACH ROW EXECUTE FUNCTION public.year_rollover_section_map_check_sections();
--> statement-breakpoint
CREATE TRIGGER users_revoke_sessions_on_password_change AFTER UPDATE OF password_hash ON public.users FOR EACH ROW WHEN ((old.password_hash IS DISTINCT FROM new.password_hash)) EXECUTE FUNCTION public.revoke_sessions_on_password_change();
--> statement-breakpoint

-- 6. FORCE ROW LEVEL SECURITY on every table
-- Drizzle only enables row security; without FORCE the table owner bypasses every policy.
-- A table added by a later migration needs its own FORCE statement.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.oid::regclass AS rel
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
  LOOP
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t.rel);
  END LOOP;
END
$$;
--> statement-breakpoint

-- 7. Privileges of the application roles
-- Start from nothing so the result does not depend on the default privileges of the
-- database: the institute and platform roles read and write, the reseller role reads,
-- and the exceptions follow. Row security narrows every one of these to the caller's rows.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM roviq_app, roviq_reseller, roviq_admin;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO roviq_app, roviq_admin;
--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA public TO roviq_reseller;
--> statement-breakpoint
-- No access at all.
REVOKE ALL ON auth_providers, auth_providers_live, device_tokens, group_memberships,
  group_memberships_live, messaging_inbound_events, messaging_opt_outs,
  messaging_sender_secrets, payment_gateway_configs, platform_memberships,
  platform_memberships_live, reseller_memberships, reseller_memberships_live, users
  FROM roviq_app;
--> statement-breakpoint
REVOKE ALL ON auth_providers, auth_providers_live, device_tokens, group_memberships,
  group_memberships_live, messaging_inbound_events, messaging_opt_outs,
  messaging_sender_secrets, messaging_senders, notification_deliveries, platform_memberships,
  platform_memberships_live, users
  FROM roviq_reseller;
--> statement-breakpoint
-- Narrower or wider than the rule above.
REVOKE ALL ON institute_groups
  FROM roviq_admin;
--> statement-breakpoint
GRANT ALL ON institute_groups
  TO roviq_admin;
--> statement-breakpoint
REVOKE ALL ON messaging_inbound_events, messaging_opt_outs, notification_deliveries
  FROM roviq_admin;
--> statement-breakpoint
GRANT SELECT, INSERT ON messaging_inbound_events, messaging_opt_outs, notification_deliveries
  TO roviq_admin;
--> statement-breakpoint
REVOKE ALL ON auth_events
  FROM roviq_app;
--> statement-breakpoint
GRANT INSERT ON auth_events
  TO roviq_app;
--> statement-breakpoint
REVOKE ALL ON audit_logs
  FROM roviq_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_logs
  TO roviq_app;
--> statement-breakpoint
REVOKE ALL ON impersonation_sessions, institutes, invoices, messaging_senders,
  notification_deliveries, notifications, payments, phone_numbers, plans, subscriptions
  FROM roviq_app;
--> statement-breakpoint
GRANT SELECT ON impersonation_sessions, institutes, invoices, messaging_senders,
  notification_deliveries, notifications, payments, phone_numbers, plans, subscriptions
  TO roviq_app;
--> statement-breakpoint
REVOKE ALL ON invoices, payment_gateway_configs, payments, plans, reseller_invoice_sequences,
  reseller_memberships, subscriptions
  FROM roviq_reseller;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON invoices, payment_gateway_configs, payments, plans,
  reseller_invoice_sequences, reseller_memberships, subscriptions
  TO roviq_reseller;
--> statement-breakpoint
REVOKE ALL ON auth_events
  FROM roviq_reseller;
--> statement-breakpoint
GRANT INSERT ON auth_events
  TO roviq_reseller;
--> statement-breakpoint
REVOKE ALL ON audit_logs
  FROM roviq_reseller;
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_logs
  TO roviq_reseller;
--> statement-breakpoint
REVOKE ALL ON files, institutes
  FROM roviq_reseller;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON files, institutes
  TO roviq_reseller;
--> statement-breakpoint
-- Column grants: password_hash and token_version of users stay unreadable, a reseller
-- edits only its own settings, and a notification can only be marked read or archived.
GRANT UPDATE (read_at, archived_at, updated_at, updated_by, version) ON notifications TO roviq_app, roviq_reseller;
--> statement-breakpoint
GRANT UPDATE (name, branding, logo_file_id, favicon_file_id, registration_number,
  registration_state, contact, address, updated_at, updated_by, version) ON resellers TO roviq_reseller;
--> statement-breakpoint
GRANT SELECT (id, email, username, avatar_url, preferred_locale, status, password_changed_at,
  must_change_password, email_verified_at, created_at, updated_at, created_by, updated_by,
  deleted_at, deleted_by, version) ON users TO roviq_app, roviq_reseller;
--> statement-breakpoint

-- 8. Audit log partitions
-- The current month and six ahead; the API gateway keeps the buffer filled from then on.
-- ensure_monthly_partition also strips every privilege from a partition and forces row security on it.
SELECT ensure_monthly_partition('audit_logs'::regclass, gs)
  FROM generate_series(
    date_trunc('month', now()),
    date_trunc('month', now()) + interval '6 months',
    interval '1 month'
  ) AS gs;
