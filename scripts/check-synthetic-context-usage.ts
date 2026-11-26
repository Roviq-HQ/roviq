// CI guard — `mkAdminCtx` / `mkResellerCtx` / `mkInstituteCtx` are synthetic
// auth-context factories that bypass JWT scope. They are an intentional
// backdoor for code that runs without a request: Temporal workflow activities,
// seeders, repositories called from those, internal admin services, and
// integration-test fixtures. Adding any new importer is a visible PR diff
// that must be justified in review — the allowlist below is the audit trail.
//
// Why this matters: a resolver that imports `mkAdminCtx()` silently runs
// every DB call as the admin role, bypassing tenant-scope RLS. The branded
// RequestContext (Item 4) makes wrong-scope-vs-wrapper combinations a
// compile error, but `mkAdminCtx()` produces a *valid* PlatformContext
// from thin air — only this allowlist gates that backdoor.

import { type Dirent, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

const SCAN_ROOTS = [join(ROOT, 'apps'), join(ROOT, 'ee'), join(ROOT, 'libs')];

// Every file currently authorized to import a synthetic-context factory.
// See header comment. Sorted alphabetically — easier to diff in PRs.
export const SYNTHETIC_CONTEXT_ALLOWLIST: ReadonlySet<string> = new Set([
  // Repository refactor: each file below holds the queries its service ran before, with the
  // same contexts and origins; the services themselves no longer reach the database.
  'apps/api-gateway/src/admin/attendance/repositories/admin-attendance.drizzle-repository.ts',
  'apps/api-gateway/src/admin/institute/repositories/admin-institute.drizzle-repository.ts',
  'apps/api-gateway/src/admin/reseller/repositories/admin-reseller.drizzle-repository.ts',
  'apps/api-gateway/src/auth/repositories/auth-event.drizzle-repository.ts',
  'apps/api-gateway/src/auth/repositories/identity.drizzle-repository.ts',
  'apps/api-gateway/src/auth/repositories/impersonation.drizzle-repository.ts',
  'apps/api-gateway/src/dlq/repositories/dlq.drizzle-repository.ts',
  'apps/api-gateway/src/files/repositories/profile-photo.drizzle-repository.ts',
  'apps/api-gateway/src/institute/admission/__tests__/application-create.integration.spec.ts',
  'apps/api-gateway/src/institute/admission/admission-read.repository.ts',
  'apps/api-gateway/src/institute/admission/repositories/admission.drizzle-repository.ts',
  'apps/api-gateway/src/institute/consent/repositories/consent.drizzle-repository.ts',
  'apps/api-gateway/src/institute/group/repositories/group.drizzle-repository.ts',
  'apps/api-gateway/src/institute/guardian/repositories/guardian.drizzle-repository.ts',
  'apps/api-gateway/src/institute/management/seed/repositories/institute-seeder.drizzle-repository.ts',
  'apps/api-gateway/src/institute/management/seed/repositories/institute-setup.drizzle-repository.ts',
  'apps/api-gateway/src/institute/staff/repositories/staff-qualification.drizzle-repository.ts',
  'apps/api-gateway/src/institute/staff/repositories/staff.drizzle-repository.ts',
  'apps/api-gateway/src/institute/student/__tests__/student-read-statistics.spec.ts',
  'apps/api-gateway/src/institute/student/__tests__/section-capacity-warning.integration.spec.ts',
  'apps/api-gateway/src/institute/student/__tests__/seeded-admission-series.integration.spec.ts',
  'apps/api-gateway/src/institute/student/__tests__/student-section-change.integration.spec.ts',
  'apps/api-gateway/src/institute/student/repositories/student-academic.drizzle-repository.ts',
  'apps/api-gateway/src/institute/student/repositories/student.drizzle-repository.ts',
  'apps/api-gateway/src/institute/student/student-read.repository.ts',
  'apps/api-gateway/src/institute/user/repositories/profile.drizzle-repository.ts',
  'apps/api-gateway/src/reseller/user/repositories/reseller-user.drizzle-repository.ts',
  'ee/apps/api-gateway/src/billing/repositories/dashboard.repository.ts',
  'apps/api-gateway/src/__tests__/billing.integration.spec.ts',
  'apps/api-gateway/src/__tests__/integration-app.integration.spec.ts',
  'apps/api-gateway/src/__tests__/people-restore.integration.spec.ts',
  'apps/api-gateway/src/__tests__/rls-cross-scope-isolation.integration.spec.ts',
  'apps/api-gateway/src/__tests__/soft-delete-audit.integration.spec.ts',
  // ROV-204: isolated authorization fixtures and in-memory read-policy tests only.
  'apps/api-gateway/src/__tests__/student-read-authorization.integration.spec.ts',
  // ROV-292: fixtures, and reads/writes as roviq_app with another institute's tenant context.
  'apps/api-gateway/src/__tests__/tenant-user-profile-isolation.integration.spec.ts',
  // ROV-293: foreign-id fixtures (rows of a second institute or reseller) and their read-back.
  'apps/api-gateway/src/__tests__/billing-foreign-id.integration.spec.ts',
  'apps/api-gateway/src/audit/__tests__/audit-foreign-id.integration.spec.ts',
  'apps/api-gateway/src/files/__tests__/files-foreign-id.integration.spec.ts',
  'apps/api-gateway/src/institute/academic-year/__tests__/academic-year-foreign-id.integration.spec.ts',
  'apps/api-gateway/src/institute/admission/__tests__/admission-foreign-id.integration.spec.ts',
  'apps/api-gateway/src/institute/attendance/__tests__/attendance-foreign-id.integration.spec.ts',
  'apps/api-gateway/src/institute/certificate/__tests__/certificate-foreign-id.integration.spec.ts',
  'apps/api-gateway/src/institute/consent/__tests__/consent-foreign-id.integration.spec.ts',
  'apps/api-gateway/src/institute/examination/__tests__/examination-foreign-id.fixture.ts',
  // ROV-217 fixtures: student and parent roles, a guardian link and published instances.
  'apps/api-gateway/src/institute/examination/__tests__/report-card-own-access.integration.spec.ts',
  'apps/api-gateway/src/institute/group/__tests__/group-crud.integration.spec.ts',
  'apps/api-gateway/src/institute/group/__tests__/group-foreign-id.integration.spec.ts',
  'apps/api-gateway/src/institute/group/__tests__/group-invalidation.integration.spec.ts',
  'apps/api-gateway/src/institute/guardian/__tests__/guardian-create-foreign-id.integration.spec.ts',
  'apps/api-gateway/src/institute/guardian/__tests__/guardian-foreign-id.integration.spec.ts',
  // ROV-358: a parent role and a student for the repeated-link test.
  'apps/api-gateway/src/institute/guardian/__tests__/guardian-duplicates.integration.spec.ts',
  'apps/api-gateway/src/institute/holiday/__tests__/holiday-foreign-id.integration.spec.ts',
  'apps/api-gateway/src/institute/leave/__tests__/leave-foreign-id.integration.spec.ts',
  'apps/api-gateway/src/institute/management/__tests__/institute-branding-foreign-id.integration.spec.ts',
  'apps/api-gateway/src/institute/profile-photo/__tests__/profile-photo-foreign-id.integration.spec.ts',
  'apps/api-gateway/src/institute/section/__tests__/section-foreign-id.integration.spec.ts',
  'apps/api-gateway/src/institute/staff/__tests__/staff-foreign-id.integration.spec.ts',
  // ROV-349: a Teacher role for the test institute and reads of the stored staff rows.
  'apps/api-gateway/src/institute/staff/__tests__/staff-create-atomic.integration.spec.ts',
  'apps/api-gateway/src/institute/staff/__tests__/staff-employee-id.integration.spec.ts',
  'apps/api-gateway/src/institute/standard/__tests__/standard-foreign-id.integration.spec.ts',
  'apps/api-gateway/src/institute/student/__tests__/student-create-foreign-id.integration.spec.ts',
  // ROV-275: fixtures and row snapshots for the one-transaction student create and its cleanup.
  'apps/api-gateway/src/institute/student/__tests__/student-create-atomic.integration.spec.ts',
  'apps/api-gateway/src/institute/student/__tests__/student-bulk-import-atomic.integration.spec.ts',
  // ROV-367: config, class and counter fixtures for supplied and generated admission numbers.
  'apps/api-gateway/src/institute/student/__tests__/supplied-admission-number.integration.spec.ts',
  'apps/api-gateway/src/auth/__tests__/discard-new-user.integration.spec.ts',
  // ROV-362: reads the stored account and phone after IdentityService.createUser.
  'apps/api-gateway/src/auth/__tests__/create-user.integration.spec.ts',
  'apps/api-gateway/src/institute/student/__tests__/student-foreign-id.integration.spec.ts',
  'apps/api-gateway/src/institute/subject/__tests__/subject-foreign-id.integration.spec.ts',
  'apps/api-gateway/src/institute/timetable/__tests__/timetable-foreign-id.integration.spec.ts',
  'apps/api-gateway/src/reseller/__tests__/reseller-foreign-id.integration.spec.ts',
  'apps/api-gateway/src/reseller/institute/__tests__/reseller-institute-foreign-id.integration.spec.ts',
  // ROV-205: isolated security-invariant fixtures and RLS-scoped predicate execution only.
  'apps/api-gateway/src/__tests__/user-groups-security-invariants.integration.spec.ts',
  'apps/api-gateway/src/files/repositories/file.drizzle-repository.ts',
  // ROV-314: device_tokens is platform-role only; every write is keyed by the token user id.
  'apps/api-gateway/src/notification-inbox/repositories/device-token.drizzle-repository.ts',
  // ROV-314: notification, delivery and impersonation-session fixtures for the inbox tests only.
  'apps/api-gateway/src/notification-inbox/__tests__/notification-inbox.integration.spec.ts',
  // ROV-327: student, guardian, notification and delivery fixtures for the institute log tests only.
  'apps/api-gateway/src/institute/notification-delivery/__tests__/notification-delivery-log.integration.spec.ts',
  // ROV-301: files read as the caller's own role; profile photo writes on the shared user profile.
  'apps/api-gateway/src/files/file.loaders.ts',
  'apps/api-gateway/src/institute/profile-photo/profile-photo-target.repository.ts',
  // ROV-210: isolated fixtures for the files RLS and attach-guard tests only.
  'apps/api-gateway/src/files/__tests__/files-rls.integration.spec.ts',
  // ROV-300: hard deletes of files across institutes for the sweeper workflow and FileService.purge.
  'apps/api-gateway/src/files/file-purge.repository.ts',
  // ROV-300: isolated fixtures (institutes, files, link rows) for the sweeper tests only.
  'apps/api-gateway/src/files/__tests__/file-sweeper.integration.spec.ts',
  'apps/api-gateway/src/institute/academic-year/repositories/academic-year.drizzle-repository.ts',
  'apps/api-gateway/src/admin/institute/admin-institute.loaders.ts',
  // ROV-184: integration fixtures (refresh tokens) for the tenant analytics query.
  'apps/api-gateway/src/admin/monitoring/tenant-analytics/__tests__/tenant-analytics.integration.spec.ts',
  'apps/api-gateway/src/admin/reseller/__tests__/reseller-suspension.integration.spec.ts',
  'apps/api-gateway/src/auth/__tests__/email-verification.integration.spec.ts',
  'apps/api-gateway/src/auth/__tests__/institute-status-access.integration.spec.ts',
  'apps/api-gateway/src/institute/section/__tests__/section-strength.integration.spec.ts',
  // ROV-316: integration fixtures (years, standards, sections, students, groups) for the JetStream handlers.
  'apps/api-gateway/src/institute/student/__tests__/gateway-event-handlers.integration.spec.ts',
  // ROV-321: integration fixtures (years, standards, institute type) and the write-mode rollover.
  'apps/api-gateway/src/institute/student/__tests__/year-end-promotion.integration.spec.ts',
  // ROV-323: integration fixtures (years, classes, sections, students) and RLS checks per role.
  'apps/api-gateway/src/institute/academic-year/__tests__/rollover-section-map.integration.spec.ts',
  // ROV-322: integration fixtures (years, classes, records, groups) and the write-mode rollover.
  'apps/api-gateway/src/institute/student/__tests__/student-placement-correction.integration.spec.ts',
  // ROV-315: integration fixtures (users, delivery rows) and the leak check over audit and notification tables.
  'apps/api-gateway/src/institute/sign-in-details/__tests__/sign-in-details.integration.spec.ts',
  // ROV-181: integration fixtures (profile, phone, identifiers, auth events) for admin user queries.
  'apps/api-gateway/src/admin/user/__tests__/admin-user.integration.spec.ts',
  'apps/api-gateway/src/admin/user/repositories/admin-user.drizzle-repository.ts',
  'apps/api-gateway/src/audit/repositories/audit-partition.drizzle-repository.ts',
  'apps/api-gateway/src/audit/repositories/audit-query.drizzle-repository.ts',
  'apps/api-gateway/src/audit/workflows/partition.activities.ts',
  'apps/api-gateway/src/auth/__tests__/impersonation.integration.spec.ts',
  // ROV-344: impersonation-session fixture and the column-grant refusals as the institute and
  // reseller roles.
  'apps/api-gateway/src/auth/__tests__/form-help-mode.integration.spec.ts',
  'apps/api-gateway/src/auth/middleware/impersonation-session.guard.ts',
  // ROV-97: global guard reads the reseller's status before any resolver runs.
  // Reads an institute's status for any institute-scope token, before a tenant context exists.
  'apps/api-gateway/src/auth/middleware/institute-access.guard.ts',
  // Reads one user's token_version before any resolver runs; the id comes from the verified token.
  'apps/api-gateway/src/auth/middleware/token-version.guard.ts',
  'apps/api-gateway/src/auth/middleware/reseller-access.guard.ts',
  'apps/api-gateway/src/auth/repositories/membership.drizzle-repository.ts',
  'apps/api-gateway/src/auth/repositories/platform-membership.drizzle-repository.ts',
  'apps/api-gateway/src/auth/repositories/refresh-token.drizzle-repository.ts',
  'apps/api-gateway/src/auth/repositories/reseller-membership.drizzle-repository.ts',
  'apps/api-gateway/src/auth/repositories/user.drizzle-repository.ts',
  'apps/api-gateway/src/institute/role/__tests__/role.integration.spec.ts',
  'apps/api-gateway/src/institute/role/repositories/role.drizzle-repository.ts',
  'apps/api-gateway/src/casl/__tests__/read-field.middleware.spec.ts',
  // ROV-19: platform-admin DLQ reader — no repository layer; admin tool mirrors admin-reseller.service.
  'apps/api-gateway/src/institute/institute-group/repositories/institute-group.drizzle-repository.ts',
  'apps/api-gateway/src/institute/admission/__tests__/admission-statistics.spec.ts',
  'apps/api-gateway/src/institute/admission/__tests__/application.integration.spec.ts',
  'apps/api-gateway/src/institute/admission/__tests__/enquiry.integration.spec.ts',
  'apps/api-gateway/src/institute/admission/workflows/student-admission.activities.ts',
  // ROV-232: flags test accounts as needing a password change and grants a platform role.
  'apps/api-gateway/src/auth/__tests__/must-change-password.integration.spec.ts',
  // ROV-232: records a first admin on a test institute to check who may read it.
  'apps/api-gateway/src/institute/management/__tests__/institute-first-admin.integration.spec.ts',
  // ROV-232: reads what the setup workflow wrote, to compare it with direct creation.
  'apps/api-gateway/src/institute/setup/__tests__/institute-setup.integration.spec.ts',
  'apps/api-gateway/src/institute/attendance/__tests__/attendance-authorization.integration.spec.ts',
  'apps/api-gateway/src/institute/attendance/__tests__/attendance.integration.spec.ts',
  'apps/api-gateway/src/institute/attendance/repositories/attendance.drizzle-repository.ts',
  'apps/api-gateway/src/institute/bot/__tests__/bot-api-key.integration.spec.ts',
  'apps/api-gateway/src/institute/bot/repositories/bot-profile.drizzle-repository.ts',
  // ROV-296: isolated fixtures and RLS probes for the compliance export tests only.
  'apps/api-gateway/src/institute/certificate/__tests__/compliance-export-activities.integration.spec.ts',
  'apps/api-gateway/src/institute/certificate/__tests__/compliance-export.integration.spec.ts',
  'apps/api-gateway/src/institute/certificate/__tests__/compliance-generators.integration.spec.ts',
  'apps/api-gateway/src/institute/certificate/__tests__/tc-issuance.spec.ts',
  'apps/api-gateway/src/institute/certificate/__tests__/tc.integration.spec.ts',
  'apps/api-gateway/src/institute/certificate/exports/awr.export.ts',
  // ROV-296: compliance export generators and activities, run by the export workflow as the institute it names.
  'apps/api-gateway/src/institute/certificate/exports/bseh-staff-statement.export.ts',
  'apps/api-gateway/src/institute/certificate/exports/cbse-candidates.ts',
  'apps/api-gateway/src/institute/certificate/exports/rte-report.export.ts',
  'apps/api-gateway/src/institute/certificate/exports/shala-darpan.export.ts',
  'apps/api-gateway/src/institute/certificate/exports/tc-register.export.ts',
  'apps/api-gateway/src/institute/certificate/exports/udise-dcf.export.ts',
  // Public TC verification: an anonymous caller, served only through the verify_tc() function.
  'apps/api-gateway/src/public-verification/tc-verification.repository.ts',
  'apps/api-gateway/src/institute/certificate/workflows/compliance-export.activities.ts',
  'apps/api-gateway/src/institute/certificate/workflows/tc-issuance.activities.ts',
  'apps/api-gateway/src/institute/examination/repositories/examination.drizzle-repository.ts',
  'apps/api-gateway/src/institute/group/group-invalidation.handler.ts',
  'apps/api-gateway/src/institute/holiday/repositories/holiday.drizzle-repository.ts',
  // ROV-304: isolated fixtures for the leave read/write/decide authorization tests only.
  'apps/api-gateway/src/institute/leave/__tests__/leave-authorization.integration.spec.ts',
  'apps/api-gateway/src/institute/leave/repositories/leave.drizzle-repository.ts',
  'apps/api-gateway/src/institute/management/repositories/institute.drizzle-repository.ts',
  'apps/api-gateway/src/institute/section/repositories/section.drizzle-repository.ts',
  'apps/api-gateway/src/institute/setup/institute-setup.activities.ts',
  'apps/api-gateway/src/institute/standard/repositories/standard.drizzle-repository.ts',
  'apps/api-gateway/src/institute/student/__tests__/admission-number-series.integration.spec.ts',
  'apps/api-gateway/src/institute/student/__tests__/student-detail.integration.spec.ts',
  // ROV-300: isolated fixtures for the student document removal tests only.
  'apps/api-gateway/src/institute/student/__tests__/student-document-removal.integration.spec.ts',
  // ROV-300: isolated fixtures for the student document upload tests only.
  'apps/api-gateway/src/institute/student/__tests__/student-document-upload.integration.spec.ts',
  'apps/api-gateway/src/institute/student/student-event.handler.ts',
  // File access for Temporal activities; every query runs as the institute the workflow names.
  'apps/api-gateway/src/files/workflow-file-store.ts',
  'apps/api-gateway/src/files/__tests__/workflow-file-store.integration.spec.ts',
  'apps/api-gateway/src/institute/student/workflows/bulk-student-import.activities.ts',
  'apps/api-gateway/src/institute/subject/__tests__/subject-links.integration.spec.ts',
  'apps/api-gateway/src/institute/subject/repositories/subject.drizzle-repository.ts',
  'apps/api-gateway/src/institute/timetable/__tests__/teacher-options.integration.spec.ts',
  'apps/api-gateway/src/institute/timetable/repositories/timetable.drizzle-repository.ts',
  'apps/api-gateway/src/institute/notification-config/repositories/notification-config.drizzle-repository.ts',
  'apps/api-gateway/src/passkey/repositories/auth-provider.drizzle-repository.ts',
  // ROV-290: isolated reseller/group fixtures and direct group-link assertions only.
  'apps/api-gateway/src/reseller/institute-group/__tests__/reseller-institute-group.integration.spec.ts',
  // ROV-186 fixtures: system roles, role switches and stored-row assertions for the settings spec.
  'apps/api-gateway/src/reseller/settings/__tests__/reseller-settings.integration.spec.ts',
  // ROV-284 fixtures: system roles and role switches for the ability spec.
  'apps/api-gateway/src/reseller/__tests__/reseller-role-abilities.integration.spec.ts',
  // ROV-185 fixtures: system roles, known passwords and stored-row assertions for the team spec.
  'apps/api-gateway/src/reseller/team/__tests__/reseller-team.integration.spec.ts',
  // ROV-185: roles, auth_events and refresh_tokens are unreadable as roviq_reseller.
  'apps/api-gateway/src/reseller/team/repositories/reseller-team.drizzle-repository.ts',
  // ROV-101 fixture: reads the teacher role's stored name to compare with the API.
  'apps/api-gateway/src/reseller/user/__tests__/user-listing-roles.integration.spec.ts',
  // ROV-302 integration fixture: inserts files of each status and owner to measure usage
  'apps/api-gateway/src/files/__tests__/storage-quota.integration.spec.ts',
  // ROV-311 integration fixture: inserts audit rows and reads them as each institute's role
  'apps/api-gateway/src/audit/__tests__/audit-subject-institute.integration.spec.ts',
  'apps/notification-service/src/repositories/billing-read.drizzle-repository.ts',
  'apps/notification-service/src/repositories/notification-config-read.drizzle-repository.ts',
  // ROV-314 event consumer: guardians and memberships read as the event's institute
  'apps/notification-service/src/repositories/recipient-read.drizzle-repository.ts',
  // ROV-314: users, phone_numbers and device_tokens are platform tables; no JWT in a consumer
  'apps/notification-service/src/repositories/contact-read.drizzle-repository.ts',
  // ROV-269: reads a guardian's consent rows under the institute named by the event.
  'apps/notification-service/src/repositories/consent-read.drizzle-repository.ts',
  // ROV-314: notifications and notification_deliveries are written by roviq_admin only
  'apps/notification-service/src/repositories/notification-write.drizzle-repository.ts',
  // ROV-319: senders, their tokens, opt-outs and inbound events are platform-role tables
  'apps/notification-service/src/repositories/messaging-sender.drizzle-repository.ts',
  'apps/notification-service/src/repositories/messaging-inbound.drizzle-repository.ts',
  // ROV-333: template rows are written by the sync and the provider's events; no caller context
  'apps/notification-service/src/repositories/messaging-template.drizzle-repository.ts',
  // ROV-318: a provider's delivery report appends a row copied from the message's own SENT row
  'apps/notification-service/src/repositories/delivery-receipt.drizzle-repository.ts',
  // ROV-319 integration fixtures: senders with tokens and phone numbers of the recipients
  'apps/notification-service/src/__tests__/whatsapp-delivery.integration.spec.ts',
  // ROV-314 integration fixtures: institutes, guardian links and stored notification rows
  'apps/notification-service/src/__tests__/notification-pipeline.integration.spec.ts',
  // ROV-328: fixture rows (families, staff profiles) for the guardian order.
  'apps/notification-service/src/__tests__/guardian-order.integration.spec.ts',
  // ROV-351: years, standards, sections and coordinator roles for the capacity warning.
  'apps/notification-service/src/__tests__/section-capacity.integration.spec.ts',
  // ROV-332 event consumer: seen and push-acknowledged events read notification rows by recipient
  'apps/notification-service/src/repositories/flow-arrival.drizzle-repository.ts',
  // ROV-332 integration fixtures: families with phones, device tokens and consent rows
  'apps/notification-service/src/__tests__/notification-flow.integration.spec.ts',
  // ROV-329: the canary's last success per channel seeds a gauge at start; no caller context
  'apps/notification-service/src/repositories/canary-read.drizzle-repository.ts',
  // ROV-336: recent skips counted for a gauge on each metric export; no caller context
  'apps/notification-service/src/repositories/delivery-stats.drizzle-repository.ts',
  // ROV-329 integration fixture: the platform's WhatsApp sender for the canary
  'apps/notification-service/src/__tests__/delivery-canary.integration.spec.ts',
  // ROV-330 integration fixtures: senders with a rate, read back after the provider blocks one
  'apps/notification-service/src/__tests__/delivery-limits.integration.spec.ts',
  // ROV-329 integration fixture: a platform role without read SystemHealth
  'apps/api-gateway/src/admin/monitoring/notification-health/__tests__/notification-health.integration.spec.ts',
  'ee/apps/api-gateway/src/billing/billing-event.consumer.ts',
  'ee/apps/api-gateway/src/billing/billing.repository.ts',
  'ee/apps/api-gateway/src/billing/repositories/gateway-config.repository.ts',
  'ee/apps/api-gateway/src/billing/repositories/invoice.repository.ts',
  'ee/apps/api-gateway/src/billing/repositories/payment.repository.ts',
  'ee/apps/api-gateway/src/billing/repositories/plan.repository.ts',
  'ee/apps/api-gateway/src/billing/repositories/subscription.repository.ts',
  'ee/apps/api-gateway/src/billing/subscription-reader.impl.ts',
  'ee/apps/api-gateway/src/billing/workflows/billing.activities.ts',
  // ROV-295: billing activity fixtures, written and read back in a transaction that is rolled back.
  'ee/apps/api-gateway/src/billing/__tests__/billing-activities.integration.spec.ts',
  'ee/libs/backend/payments/src/repositories/payment-gateway-config.drizzle-repository.ts',
  'libs/backend/casl/src/repositories/membership-ability.drizzle-repository.ts',
  'libs/backend/casl/src/repositories/role.drizzle-repository.ts',
  'libs/backend/casl/src/seed-roles.ts',
  'libs/backend/testing/src/integration/data-factories.ts',
  'libs/database/src/index.ts',
  'libs/database/src/seed/demo/index.ts',
  'libs/database/src/seed/e2e/index.ts',
  'libs/database/src/seed/essential/index.ts',
  'libs/database/src/tenant-db.ts',
]);

const SYNTHETIC_IMPORT_RE = /\b(mkAdminCtx|mkResellerCtx|mkInstituteCtx)\b/;

interface Hit {
  relativePath: string;
}

function walk(dir: string, out: string[]): void {
  // `withFileTypes: true` returns Dirent entries — avoids a per-child
  // `statSync` and sidesteps broken symlinks crashing the walk.
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = entry.name;
    if (name === 'node_modules' || name === 'dist' || name === '.next') continue;
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile() && (name.endsWith('.ts') || name.endsWith('.tsx'))) {
      out.push(full);
    }
  }
}

export function findUnauthorizedUsages(
  scanRoots: string[] = SCAN_ROOTS,
  allowlist: ReadonlySet<string> = SYNTHETIC_CONTEXT_ALLOWLIST,
  projectRoot: string = ROOT,
): Hit[] {
  const hits: Hit[] = [];
  const files: string[] = [];
  for (const root of scanRoots) walk(root, files);
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (!SYNTHETIC_IMPORT_RE.test(text)) continue;
    const rel = relative(projectRoot, file).replace(/\\/g, '/');
    if (allowlist.has(rel)) continue;
    hits.push({ relativePath: rel });
  }
  return hits;
}

function main(): number {
  const hits = findUnauthorizedUsages();
  if (hits.length === 0) {
    process.stdout.write(
      'check:synthetic-context-usage — every mk*Ctx importer is on the allowlist.\n',
    );
    return 0;
  }
  process.stderr.write(
    `check:synthetic-context-usage — ${hits.length} unauthorized importer(s) of synthetic auth-context factories:\n\n`,
  );
  for (const hit of hits) {
    process.stderr.write(`  ${hit.relativePath}\n`);
  }
  process.stderr.write(
    '\nmkAdminCtx / mkResellerCtx / mkInstituteCtx bypass JWT scope — they are NOT for resolvers or business services that receive an AuthUser.\n' +
      'If this importer genuinely needs synthetic auth (workflow, seeder, event consumer, repository called from one of those):\n' +
      '  1. Add the file path to SYNTHETIC_CONTEXT_ALLOWLIST in scripts/check-synthetic-context-usage.ts\n' +
      '  2. Justify the addition in the PR description (security reviewer signoff required)\n' +
      'Otherwise: refactor the caller to receive an AuthUser via the request and use assertX helpers.\n',
  );
  return 1;
}

if (process.argv[1]?.endsWith('check-synthetic-context-usage.ts')) {
  process.exit(main());
}
