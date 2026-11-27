/**
 * CI guard: a foreign key between two tables that carry `tenant_id` includes `tenant_id`, so
 * PostgreSQL refuses a row that names another institute's row, whichever role writes it.
 * Declare one with `sameTenantForeignKey()` (`libs/database/src/schema/common/columns.ts`).
 *
 * The keys not converted yet are listed below. The lists only shrink: an entry whose key is
 * gone or now carries `tenant_id` fails the check until it is removed.
 */
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';

/** `child.column -> parent` */
export type KeyName = string;

export interface TenantKey {
  name: KeyName;
  /** The key's own columns include `tenant_id`. */
  carriesTenant: boolean;
}

/**
 * Waiting for a later batch. Each is a plain reference today: the repository reads the
 * referenced row under the caller's context before it stores the id.
 */
export const NOT_YET_CONVERTED: readonly KeyName[] = [
  'admission_applications.enquiry_id -> enquiries',
  'application_document_files.document_id -> application_documents',
  'application_documents.application_id -> admission_applications',
  'attendance_entries.session_id -> attendance_sessions',
  'attendance_sessions.subject_id -> subjects',
  'co_scholastic_areas.grading_scheme_id -> grading_schemes',
  'co_scholastic_assessments.co_scholastic_area_id -> co_scholastic_areas',
  'co_scholastic_assessments.exam_term_id -> exam_terms',
  'consent_records.guardian_profile_id -> guardian_profiles',
  'consent_records.privacy_notice_id -> privacy_notices',
  'exam_marks.exam_schedule_id -> exam_schedules',
  'exam_schedules.exam_id -> exams',
  'exam_schedules.subject_id -> subjects',
  'exam_topic_assessments.exam_schedule_id -> exam_schedules',
  'exam_topic_assessments.subject_topic_id -> subject_topics',
  'exams.exam_term_id -> exam_terms',
  'exams.grading_scheme_id -> grading_schemes',
  'grade_bands.grading_scheme_id -> grading_schemes',
  'group_children.child_group_id -> groups',
  'group_children.parent_group_id -> groups',
  'group_members.group_id -> groups',
  'group_rules.group_id -> groups',
  'groups.parent_group_id -> groups',
  'invoices.subscription_id -> subscriptions',
  'issued_certificates.staff_profile_id -> staff_profiles',
  'issued_certificates.template_id -> certificate_templates',
  'leave_files.leave_id -> leaves',
  'payments.invoice_id -> invoices',
  'report_card_instances.report_card_id -> report_cards',
  'report_cards.exam_term_id -> exam_terms',
  'report_cards.grading_scheme_id -> grading_schemes',
  'section_subjects.subject_id -> subjects',
  'staff_qualifications.staff_profile_id -> staff_profiles',
  'standard_subjects.subject_id -> subjects',
  'student_guardian_links.guardian_profile_id -> guardian_profiles',
  'subject_topics.subject_id -> subjects',
  'tc_register.original_tc_id -> tc_register',
  'timetable_day_overrides.period_id -> timetable_periods',
  'timetable_day_overrides.subject_id -> subjects',
  'timetable_day_overrides.timetable_id -> timetables',
  'timetable_entries.period_id -> timetable_periods',
  'timetable_entries.subject_id -> subjects',
  'timetable_entries.timetable_id -> timetables',
  'timetable_periods.timetable_id -> timetables',
  'timetable_sections.timetable_id -> timetables',
];

/**
 * `ON DELETE SET NULL` references. A key that carries `tenant_id` would set `tenant_id` to
 * NULL as well; PostgreSQL's `SET NULL (column)` form avoids that, and Drizzle cannot declare
 * it. They need custom SQL.
 */
export const NEEDS_SET_NULL_COLUMN_LIST: readonly KeyName[] = [
  'exam_schedules.invigilator_id -> memberships',
  'leaves.decided_by -> memberships',
  'report_card_instances.section_id -> sections',
  'sections.class_teacher_id -> memberships',
  'timetable_day_overrides.teacher_id -> memberships',
  'timetable_entries.teacher_id -> memberships',
];

/** Not convertible as they are, each with the reason. */
export const EXCLUDED: Readonly<Record<KeyName, string>> = {
  'application_document_files.file_id -> files':
    'a file that belongs to a person has no tenant_id; `markFilesReady` checks the owner',
  'export_reports.file_id -> files':
    'a file that belongs to a person has no tenant_id; `markFilesReady` checks the owner',
  'institute_branding.cover_image_file_id -> files':
    'a file that belongs to a person has no tenant_id; `markFilesReady` checks the owner',
  'institute_branding.favicon_file_id -> files':
    'a file that belongs to a person has no tenant_id; `markFilesReady` checks the owner',
  'institute_branding.logo_file_id -> files':
    'a file that belongs to a person has no tenant_id; `markFilesReady` checks the owner',
  'issued_certificates.pdf_file_id -> files':
    'a file that belongs to a person has no tenant_id; `markFilesReady` checks the owner',
  'leave_files.file_id -> files':
    'a file that belongs to a person has no tenant_id; `markFilesReady` checks the owner',
  'memberships.role_id -> roles': 'a system role has no tenant_id',
  'notification_deliveries.notification_id -> notifications':
    'a platform notification has no tenant_id',
  'notification_deliveries.sender_id -> messaging_senders': 'a platform sender has no tenant_id',
  'staff_qualifications.certificate_file_id -> files':
    'a file that belongs to a person has no tenant_id; `markFilesReady` checks the owner',
  'tc_register.pdf_file_id -> files':
    'a file that belongs to a person has no tenant_id; `markFilesReady` checks the owner',
  'tenant_user_profiles.profile_image_file_id -> files':
    'a file that belongs to a person has no tenant_id; `markFilesReady` checks the owner',
};

export function tenantKeysOf(tables: readonly PgTable[]): TenantKey[] {
  const hasTenant = (table: PgTable) =>
    getTableConfig(table).columns.some((column) => column.name === 'tenant_id');
  const keys: TenantKey[] = [];
  for (const table of tables) {
    const config = getTableConfig(table);
    if (!hasTenant(table)) continue;
    for (const foreignKey of config.foreignKeys) {
      const reference = foreignKey.reference();
      if (!hasTenant(reference.foreignTable)) continue;
      const columns = reference.columns.map((column) => column.name);
      const carriesTenant = columns.includes('tenant_id');
      const own = columns.filter((column) => column !== 'tenant_id').join(',');
      keys.push({
        name: `${config.name}.${own} -> ${getTableConfig(reference.foreignTable).name}`,
        carriesTenant,
      });
    }
  }
  return keys.sort((a, b) => a.name.localeCompare(b.name));
}

export interface Report {
  /** Keys without `tenant_id` that no list names. */
  unlisted: KeyName[];
  /** Listed keys that are gone or already carry `tenant_id`. */
  stale: KeyName[];
}

export function checkTenantKeys(keys: readonly TenantKey[], listed: readonly KeyName[]): Report {
  const plain = new Set(keys.filter((key) => !key.carriesTenant).map((key) => key.name));
  const allowed = new Set(listed);
  return {
    unlisted: [...plain].filter((name) => !allowed.has(name)),
    stale: [...allowed].filter((name) => !plain.has(name)).sort(),
  };
}

export const LISTED: readonly KeyName[] = [
  ...NOT_YET_CONVERTED,
  ...NEEDS_SET_NULL_COLUMN_LIST,
  ...Object.keys(EXCLUDED),
];

async function main(): Promise<number> {
  const core = await import('../libs/database/src/schema');
  const ee = await import('../ee/libs/database/src/schema');
  const tables = [...Object.values(core), ...Object.values(ee)].filter((value): value is PgTable =>
    is(value, PgTable),
  );
  const keys = tenantKeysOf(tables);
  if (process.argv.includes('--list')) {
    for (const key of keys)
      process.stdout.write(`${key.carriesTenant ? 'tenant' : 'plain '} ${key.name}\n`);
    return 0;
  }
  const { unlisted, stale } = checkTenantKeys(keys, LISTED);
  if (unlisted.length === 0 && stale.length === 0) {
    const converted = keys.filter((key) => key.carriesTenant).length;
    process.stdout.write(
      `check:tenant-foreign-keys OK (${converted} keys carry tenant_id, ${LISTED.length} listed as not converted)\n`,
    );
    return 0;
  }
  if (unlisted.length > 0) {
    process.stderr.write(
      `check:tenant-foreign-keys: ${unlisted.length} foreign key(s) between two tenant tables do not include tenant_id.\n` +
        'Declare each with sameTenantForeignKey() and give the referenced table a unique index on (id, tenant_id):\n\n',
    );
    for (const name of unlisted) process.stderr.write(`  ${name}\n`);
  }
  if (stale.length > 0) {
    process.stderr.write(
      `\ncheck:tenant-foreign-keys: ${stale.length} listed key(s) are gone or already include tenant_id. Remove them from the list in scripts/check-tenant-foreign-keys.ts:\n\n`,
    );
    for (const name of stale) process.stderr.write(`  ${name}\n`);
  }
  return 1;
}

if (process.argv[1]?.endsWith('check-tenant-foreign-keys.ts')) {
  main().then((code) => process.exit(code));
}
