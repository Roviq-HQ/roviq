ALTER TABLE "users" ADD COLUMN "origin_tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_origin_tenant_id_institutes_id_fkey" FOREIGN KEY ("origin_tenant_id") REFERENCES "institutes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER POLICY "phone_numbers_app_select" ON "phone_numbers" TO "roviq_app" USING (user_id IN (
      SELECT m.user_id FROM memberships m
      WHERE m.tenant_id = current_setting('app.current_tenant_id', true)::uuid
        AND m.deleted_at IS NULL
    ));--> statement-breakpoint
ALTER POLICY "phone_numbers_reseller_read" ON "phone_numbers" TO "roviq_reseller" USING (user_id IN (
      SELECT m.user_id FROM memberships m
      JOIN institutes i ON i.id = m.tenant_id
      WHERE i.reseller_id = current_setting('app.current_reseller_id', true)::uuid
        AND m.deleted_at IS NULL
    ) OR user_id IN (
      SELECT rm.user_id FROM reseller_memberships rm
      WHERE rm.reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
ALTER POLICY "users_app_select" ON "users" TO "roviq_app" USING (id IN (
        SELECT m.user_id FROM memberships m
        WHERE m.tenant_id = current_setting('app.current_tenant_id', true)::uuid
          AND m.deleted_at IS NULL
      ));--> statement-breakpoint
ALTER POLICY "users_reseller_select" ON "users" TO "roviq_reseller" USING (id IN (
        SELECT m.user_id FROM memberships m
        JOIN institutes i ON i.id = m.tenant_id
        WHERE i.reseller_id = current_setting('app.current_reseller_id', true)::uuid
          AND m.deleted_at IS NULL
      ) OR id IN (
        SELECT rm.user_id FROM reseller_memberships rm
        WHERE rm.reseller_id = current_setting('app.current_reseller_id', true)::uuid
      ));--> statement-breakpoint
ALTER POLICY "files_app_select" ON "files" TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid OR (tenant_id IS NULL AND reseller_id IS NULL AND subject_user_id IN (
  SELECT m.user_id FROM memberships m
  WHERE m.tenant_id = current_setting('app.current_tenant_id', true)::uuid
    AND m.deleted_at IS NULL
)));--> statement-breakpoint
ALTER POLICY "files_app_insert" ON "files" TO "roviq_app" WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid OR (tenant_id IS NULL AND reseller_id IS NULL AND subject_user_id IN (
  SELECT m.user_id FROM memberships m
  WHERE m.tenant_id = current_setting('app.current_tenant_id', true)::uuid
    AND m.deleted_at IS NULL
)));--> statement-breakpoint
ALTER POLICY "files_app_update" ON "files" TO "roviq_app" USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid OR (tenant_id IS NULL AND reseller_id IS NULL AND subject_user_id IN (
  SELECT m.user_id FROM memberships m
  WHERE m.tenant_id = current_setting('app.current_tenant_id', true)::uuid
    AND m.deleted_at IS NULL
))) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid OR (tenant_id IS NULL AND reseller_id IS NULL AND subject_user_id IN (
  SELECT m.user_id FROM memberships m
  WHERE m.tenant_id = current_setting('app.current_tenant_id', true)::uuid
    AND m.deleted_at IS NULL
)));--> statement-breakpoint
ALTER POLICY "files_reseller_select" ON "files" TO "roviq_reseller" USING (reseller_id = current_setting('app.current_reseller_id', true)::uuid
      OR tenant_id IN (
        SELECT id FROM institutes
        WHERE reseller_id = current_setting('app.current_reseller_id', true)::uuid
      )
      OR (tenant_id IS NULL AND reseller_id IS NULL AND (
        subject_user_id IN (
          SELECT m.user_id FROM memberships m
          JOIN institutes i ON i.id = m.tenant_id
          WHERE i.reseller_id = current_setting('app.current_reseller_id', true)::uuid
            AND m.deleted_at IS NULL
        )
        OR subject_user_id IN (
          SELECT rm.user_id FROM reseller_memberships rm
          WHERE rm.reseller_id = current_setting('app.current_reseller_id', true)::uuid
        )
      )));--> statement-breakpoint
ALTER POLICY "user_addresses_app_select" ON "user_addresses" TO "roviq_app" USING (user_id IN (
      SELECT m.user_id FROM memberships m
      WHERE m.tenant_id = current_setting('app.current_tenant_id', true)::uuid
        AND m.deleted_at IS NULL
    ));--> statement-breakpoint
ALTER POLICY "user_addresses_reseller_read" ON "user_addresses" TO "roviq_reseller" USING (user_id IN (
      SELECT m.user_id FROM memberships m
      JOIN institutes i ON i.id = m.tenant_id
      WHERE i.reseller_id = current_setting('app.current_reseller_id', true)::uuid
        AND m.deleted_at IS NULL
    ) OR user_id IN (
      SELECT rm.user_id FROM reseller_memberships rm
      WHERE rm.reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
ALTER POLICY "user_document_files_app_select" ON "user_document_files" TO "roviq_app" USING (user_id IN (
      SELECT m.user_id FROM memberships m
      WHERE m.tenant_id = current_setting('app.current_tenant_id', true)::uuid
        AND m.deleted_at IS NULL
    ));--> statement-breakpoint
ALTER POLICY "user_document_files_reseller_read" ON "user_document_files" TO "roviq_reseller" USING (user_id IN (
      SELECT m.user_id FROM memberships m
      JOIN institutes i ON i.id = m.tenant_id
      WHERE i.reseller_id = current_setting('app.current_reseller_id', true)::uuid
        AND m.deleted_at IS NULL
    ) OR user_id IN (
      SELECT rm.user_id FROM reseller_memberships rm
      WHERE rm.reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
ALTER POLICY "user_documents_app_select" ON "user_documents" TO "roviq_app" USING (user_id IN (
      SELECT m.user_id FROM memberships m
      WHERE m.tenant_id = current_setting('app.current_tenant_id', true)::uuid
        AND m.deleted_at IS NULL
    ));--> statement-breakpoint
ALTER POLICY "user_documents_reseller_read" ON "user_documents" TO "roviq_reseller" USING (user_id IN (
      SELECT m.user_id FROM memberships m
      JOIN institutes i ON i.id = m.tenant_id
      WHERE i.reseller_id = current_setting('app.current_reseller_id', true)::uuid
        AND m.deleted_at IS NULL
    ) OR user_id IN (
      SELECT rm.user_id FROM reseller_memberships rm
      WHERE rm.reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
ALTER POLICY "user_identifiers_app_select" ON "user_identifiers" TO "roviq_app" USING (user_id IN (
      SELECT m.user_id FROM memberships m
      WHERE m.tenant_id = current_setting('app.current_tenant_id', true)::uuid
        AND m.deleted_at IS NULL
    ));--> statement-breakpoint
ALTER POLICY "user_identifiers_reseller_read" ON "user_identifiers" TO "roviq_reseller" USING (user_id IN (
      SELECT m.user_id FROM memberships m
      JOIN institutes i ON i.id = m.tenant_id
      WHERE i.reseller_id = current_setting('app.current_reseller_id', true)::uuid
        AND m.deleted_at IS NULL
    ) OR user_id IN (
      SELECT rm.user_id FROM reseller_memberships rm
      WHERE rm.reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));--> statement-breakpoint
ALTER POLICY "user_profiles_app_select" ON "user_profiles" TO "roviq_app" USING (user_id IN (
      SELECT m.user_id FROM memberships m
      WHERE m.tenant_id = current_setting('app.current_tenant_id', true)::uuid
        AND m.deleted_at IS NULL
    ));--> statement-breakpoint
ALTER POLICY "user_profiles_reseller_read" ON "user_profiles" TO "roviq_reseller" USING (user_id IN (
      SELECT m.user_id FROM memberships m
      JOIN institutes i ON i.id = m.tenant_id
      WHERE i.reseller_id = current_setting('app.current_reseller_id', true)::uuid
        AND m.deleted_at IS NULL
    ) OR user_id IN (
      SELECT rm.user_id FROM reseller_memberships rm
      WHERE rm.reseller_id = current_setting('app.current_reseller_id', true)::uuid
    ));