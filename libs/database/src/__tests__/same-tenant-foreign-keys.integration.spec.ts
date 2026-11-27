/**
 * A reference from one tenant table to another carries `tenant_id` (ROV-384, ROV-387), so PostgreSQL
 * refuses a row that names another institute's row whichever role writes it.
 *
 * Each key in `SAME_TENANT_KEYS` is attempted as `roviq_admin`, the role every row policy
 * lets through. A valid row of these tables needs many other columns, and relaxing the real
 * table would lock it against the specs running beside this one. So each test copies the
 * table's columns into a scratch table, gives the copy the key exactly as the catalog
 * defines it on the real table, and inserts there, in a transaction that is rolled back.
 * The referenced rows are real rows of two institutes, or, for a referenced table the spec
 * has no rows of, two rows in a copy of it. The first test ties the lists to the catalog: a
 * key that carries `tenant_id` and is not listed fails it.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_SUPERUSER_URL } from './test-helpers';

const SYSTEM = '00000000-0000-0000-0000-000000000000';

/** [referencing table, referencing column, referenced table, constraint] */
const SAME_TENANT_KEYS: readonly (readonly [string, string, string, string])[] = [
  [
    'admission_applications',
    'academic_year_id',
    'academic_years',
    'admission_applications_academic_year_id_tenant_fkey',
  ],
  [
    'admission_applications',
    'section_id',
    'sections',
    'admission_applications_section_id_tenant_fkey',
  ],
  [
    'admission_applications',
    'standard_id',
    'standards',
    'admission_applications_standard_id_tenant_fkey',
  ],
  [
    'admission_applications',
    'student_profile_id',
    'student_profiles',
    'admission_applications_student_profile_id_tenant_fkey',
  ],
  ['attendance_entries', 'student_id', 'memberships', 'attendance_entries_student_id_tenant_fkey'],
  [
    'attendance_sessions',
    'academic_year_id',
    'academic_years',
    'attendance_sessions_academic_year_id_tenant_fkey',
  ],
  [
    'attendance_sessions',
    'lecturer_id',
    'memberships',
    'attendance_sessions_lecturer_id_tenant_fkey',
  ],
  ['attendance_sessions', 'section_id', 'sections', 'attendance_sessions_section_id_tenant_fkey'],
  ['bot_profiles', 'membership_id', 'memberships', 'bot_profiles_membership_id_tenant_fkey'],
  [
    'co_scholastic_assessments',
    'student_id',
    'memberships',
    'co_scholastic_assessments_student_id_tenant_fkey',
  ],
  [
    'consent_records',
    'student_profile_id',
    'student_profiles',
    'consent_records_student_profile_id_tenant_fkey',
  ],
  ['enquiries', 'academic_year_id', 'academic_years', 'enquiries_academic_year_id_tenant_fkey'],
  ['exam_marks', 'student_id', 'memberships', 'exam_marks_student_id_tenant_fkey'],
  ['exam_schedules', 'section_id', 'sections', 'exam_schedules_section_id_tenant_fkey'],
  ['exam_terms', 'academic_year_id', 'academic_years', 'exam_terms_academic_year_id_tenant_fkey'],
  [
    'exam_topic_assessments',
    'student_id',
    'memberships',
    'exam_topic_assessments_student_id_tenant_fkey',
  ],
  ['exams', 'academic_year_id', 'academic_years', 'exams_academic_year_id_tenant_fkey'],
  [
    'export_reports',
    'academic_year_id',
    'academic_years',
    'export_reports_academic_year_tenant_fkey',
  ],
  ['group_members', 'membership_id', 'memberships', 'group_members_membership_id_tenant_fkey'],
  [
    'guardian_profiles',
    'membership_id',
    'memberships',
    'guardian_profiles_membership_id_tenant_fkey',
  ],
  [
    'issued_certificates',
    'student_profile_id',
    'student_profiles',
    'issued_certificates_student_profile_id_tenant_fkey',
  ],
  ['leaves', 'user_id', 'memberships', 'leaves_user_id_tenant_fkey'],
  [
    'report_card_instances',
    'academic_year_id',
    'academic_years',
    'report_card_instances_academic_year_id_tenant_fkey',
  ],
  [
    'report_card_instances',
    'student_profile_id',
    'student_profiles',
    'report_card_instances_student_profile_id_tenant_fkey',
  ],
  [
    'report_cards',
    'academic_year_id',
    'academic_years',
    'report_cards_academic_year_id_tenant_fkey',
  ],
  ['section_subjects', 'section_id', 'sections', 'section_subjects_section_id_tenant_fkey'],
  ['sections', 'academic_year_id', 'academic_years', 'sections_academic_year_id_tenant_fkey'],
  ['sections', 'standard_id', 'standards', 'sections_standard_id_tenant_fkey'],
  ['staff_profiles', 'membership_id', 'memberships', 'staff_profiles_membership_id_tenant_fkey'],
  ['standard_subjects', 'standard_id', 'standards', 'standard_subjects_standard_id_tenant_fkey'],
  ['standards', 'academic_year_id', 'academic_years', 'standards_academic_year_id_tenant_fkey'],
  [
    'student_academics',
    'academic_year_id',
    'academic_years',
    'student_academics_academic_year_id_tenant_fkey',
  ],
  [
    'student_academics',
    'promoted_to_standard_id',
    'standards',
    'student_academics_promoted_to_standard_id_tenant_fkey',
  ],
  ['student_academics', 'section_id', 'sections', 'student_academics_section_id_tenant_fkey'],
  ['student_academics', 'standard_id', 'standards', 'student_academics_standard_id_tenant_fkey'],
  [
    'student_academics',
    'student_profile_id',
    'student_profiles',
    'student_academics_student_profile_id_tenant_fkey',
  ],
  [
    'student_guardian_links',
    'student_profile_id',
    'student_profiles',
    'student_guardian_links_student_profile_id_tenant_fkey',
  ],
  [
    'student_profiles',
    'membership_id',
    'memberships',
    'student_profiles_membership_id_tenant_fkey',
  ],
  ['subject_topics', 'standard_id', 'standards', 'subject_topics_standard_id_tenant_fkey'],
  ['tc_register', 'academic_year_id', 'academic_years', 'tc_register_academic_year_tenant_fkey'],
  [
    'tc_register',
    'student_profile_id',
    'student_profiles',
    'tc_register_student_profile_id_tenant_fkey',
  ],
  [
    'timetable_day_overrides',
    'section_id',
    'sections',
    'timetable_day_overrides_section_id_tenant_fkey',
  ],
  ['timetable_entries', 'section_id', 'sections', 'timetable_entries_section_id_tenant_fkey'],
  ['timetable_sections', 'section_id', 'sections', 'timetable_sections_section_id_tenant_fkey'],
  ['timetables', 'academic_year_id', 'academic_years', 'timetables_academic_year_id_tenant_fkey'],
  [
    'year_rollover_section_map',
    'academic_year_id',
    'academic_years',
    'year_rollover_section_map_academic_year_id_tenant_fkey',
  ],
  [
    'year_rollover_section_map',
    'from_section_id',
    'sections',
    'year_rollover_section_map_from_section_id_tenant_fkey',
  ],
  [
    'year_rollover_section_map',
    'to_section_id',
    'sections',
    'year_rollover_section_map_to_section_id_tenant_fkey',
  ],
];

/**
 * Keys whose referenced table has no row in the two institutes below. The referenced table
 * is copied too: two rows, one per institute, and the key points at the copy.
 */
const KEYS_WITH_COPIED_PARENT: readonly (readonly [string, string, string, string])[] = [
  [
    'admission_applications',
    'enquiry_id',
    'enquiries',
    'admission_applications_enquiry_id_tenant_fkey',
  ],
  [
    'application_document_files',
    'document_id',
    'application_documents',
    'application_document_files_document_id_tenant_fkey',
  ],
  [
    'application_documents',
    'application_id',
    'admission_applications',
    'application_documents_application_id_tenant_fkey',
  ],
  [
    'attendance_entries',
    'session_id',
    'attendance_sessions',
    'attendance_entries_session_id_tenant_fkey',
  ],
  [
    'co_scholastic_assessments',
    'co_scholastic_area_id',
    'co_scholastic_areas',
    'co_scholastic_assessments_co_scholastic_area_id_tenant_fkey',
  ],
  [
    'co_scholastic_assessments',
    'exam_term_id',
    'exam_terms',
    'co_scholastic_assessments_exam_term_id_tenant_fkey',
  ],
  [
    'consent_records',
    'guardian_profile_id',
    'guardian_profiles',
    'consent_records_guardian_profile_id_tenant_fkey',
  ],
  [
    'consent_records',
    'privacy_notice_id',
    'privacy_notices',
    'consent_records_privacy_notice_id_tenant_fkey',
  ],
  ['exam_marks', 'exam_schedule_id', 'exam_schedules', 'exam_marks_exam_schedule_id_tenant_fkey'],
  ['exam_schedules', 'exam_id', 'exams', 'exam_schedules_exam_id_tenant_fkey'],
  ['exam_schedules', 'subject_id', 'subjects', 'exam_schedules_subject_id_tenant_fkey'],
  [
    'exam_topic_assessments',
    'exam_schedule_id',
    'exam_schedules',
    'exam_topic_assessments_exam_schedule_id_tenant_fkey',
  ],
  [
    'exam_topic_assessments',
    'subject_topic_id',
    'subject_topics',
    'exam_topic_assessments_subject_topic_id_tenant_fkey',
  ],
  [
    'grade_bands',
    'grading_scheme_id',
    'grading_schemes',
    'grade_bands_grading_scheme_id_tenant_fkey',
  ],
  ['group_children', 'child_group_id', 'groups', 'group_children_child_group_id_tenant_fkey'],
  ['group_children', 'parent_group_id', 'groups', 'group_children_parent_group_id_tenant_fkey'],
  ['group_members', 'group_id', 'groups', 'group_members_group_id_tenant_fkey'],
  ['group_rules', 'group_id', 'groups', 'group_rules_group_id_tenant_fkey'],
  ['groups', 'parent_group_id', 'groups', 'groups_parent_group_id_tenant_fkey'],
  ['invoices', 'subscription_id', 'subscriptions', 'invoices_subscription_id_tenant_fkey'],
  [
    'issued_certificates',
    'staff_profile_id',
    'staff_profiles',
    'issued_certificates_staff_profile_id_tenant_fkey',
  ],
  [
    'issued_certificates',
    'template_id',
    'certificate_templates',
    'issued_certificates_template_id_tenant_fkey',
  ],
  ['leave_files', 'leave_id', 'leaves', 'leave_files_leave_id_tenant_fkey'],
  ['payments', 'invoice_id', 'invoices', 'payments_invoice_id_tenant_fkey'],
  [
    'report_card_instances',
    'report_card_id',
    'report_cards',
    'report_card_instances_report_card_id_tenant_fkey',
  ],
  ['section_subjects', 'subject_id', 'subjects', 'section_subjects_subject_id_tenant_fkey'],
  [
    'staff_qualifications',
    'staff_profile_id',
    'staff_profiles',
    'staff_qualifications_staff_profile_id_tenant_fkey',
  ],
  ['standard_subjects', 'subject_id', 'subjects', 'standard_subjects_subject_id_tenant_fkey'],
  [
    'student_guardian_links',
    'guardian_profile_id',
    'guardian_profiles',
    'student_guardian_links_guardian_profile_id_tenant_fkey',
  ],
  ['subject_topics', 'subject_id', 'subjects', 'subject_topics_subject_id_tenant_fkey'],
  ['tc_register', 'original_tc_id', 'tc_register', 'tc_register_original_tc_id_tenant_fkey'],
  [
    'timetable_day_overrides',
    'period_id',
    'timetable_periods',
    'timetable_day_overrides_period_id_tenant_fkey',
  ],
  [
    'timetable_day_overrides',
    'timetable_id',
    'timetables',
    'timetable_day_overrides_timetable_id_tenant_fkey',
  ],
  [
    'timetable_entries',
    'period_id',
    'timetable_periods',
    'timetable_entries_period_id_tenant_fkey',
  ],
  ['timetable_entries', 'timetable_id', 'timetables', 'timetable_entries_timetable_id_tenant_fkey'],
  ['timetable_periods', 'timetable_id', 'timetables', 'timetable_periods_timetable_id_tenant_fkey'],
  [
    'timetable_sections',
    'timetable_id',
    'timetables',
    'timetable_sections_timetable_id_tenant_fkey',
  ],
];

/**
 * `ON DELETE SET NULL (column)` keys, added in custom SQL. Deleting the referenced row clears
 * the one column and leaves `tenant_id`.
 */
const SET_NULL_KEYS: readonly (readonly [string, string, string, string])[] = [
  ['attendance_sessions', 'subject_id', 'subjects', 'attendance_sessions_subject_id_tenant_fkey'],
  [
    'co_scholastic_areas',
    'grading_scheme_id',
    'grading_schemes',
    'co_scholastic_areas_grading_scheme_id_tenant_fkey',
  ],
  ['exam_schedules', 'invigilator_id', 'memberships', 'exam_schedules_invigilator_id_tenant_fkey'],
  ['exams', 'exam_term_id', 'exam_terms', 'exams_exam_term_id_tenant_fkey'],
  ['exams', 'grading_scheme_id', 'grading_schemes', 'exams_grading_scheme_id_tenant_fkey'],
  ['leaves', 'decided_by', 'memberships', 'leaves_decided_by_tenant_fkey'],
  [
    'report_card_instances',
    'section_id',
    'sections',
    'report_card_instances_section_id_tenant_fkey',
  ],
  ['report_cards', 'exam_term_id', 'exam_terms', 'report_cards_exam_term_id_tenant_fkey'],
  [
    'report_cards',
    'grading_scheme_id',
    'grading_schemes',
    'report_cards_grading_scheme_id_tenant_fkey',
  ],
  ['sections', 'class_teacher_id', 'memberships', 'sections_class_teacher_id_tenant_fkey'],
  [
    'timetable_day_overrides',
    'subject_id',
    'subjects',
    'timetable_day_overrides_subject_id_tenant_fkey',
  ],
  [
    'timetable_day_overrides',
    'teacher_id',
    'memberships',
    'timetable_day_overrides_teacher_id_tenant_fkey',
  ],
  ['timetable_entries', 'subject_id', 'subjects', 'timetable_entries_subject_id_tenant_fkey'],
  ['timetable_entries', 'teacher_id', 'memberships', 'timetable_entries_teacher_id_tenant_fkey'],
];

type Parent = 'academic_years' | 'memberships' | 'sections' | 'standards' | 'student_profiles';

/** One institute with a row of every referenced table. */
interface Institute {
  resellerId: string;
  tenantId: string;
  userId: string;
  roleId: string;
  rows: Record<Parent, string>;
}

let pool: pg.Pool;
let own: Institute;
let other: Institute;

async function createInstitute(client: pg.PoolClient): Promise<Institute> {
  const tag = randomUUID().slice(0, 8);
  const one = async (text: string, params: unknown[]): Promise<string> =>
    (await client.query<{ id: string }>(text, params)).rows[0].id;

  const resellerId = await one(
    `INSERT INTO resellers (name, slug, created_by, updated_by) VALUES ($1, $2, $3, $3) RETURNING id`,
    [`ROV-384 ${tag}`, `rov384-${tag}`, SYSTEM],
  );
  const tenantId = await one(
    `INSERT INTO institutes (name, slug, reseller_id, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $4) RETURNING id`,
    [JSON.stringify({ en: `ROV-384 ${tag}` }), `rov384-inst-${tag}`, resellerId, SYSTEM],
  );
  const userId = await one(
    `INSERT INTO users (username, email, password_hash, origin_tenant_id, created_by, updated_by)
     VALUES ($1, $2, 'not-a-real-hash', $3, $4, $4) RETURNING id`,
    [`rov384-${tag}`, `rov384-${tag}@test.local`, tenantId, SYSTEM],
  );
  const roleId = await one(
    `INSERT INTO roles (tenant_id, scope, name, abilities, created_by, updated_by)
     VALUES ($1, 'institute', $2, '[]', $3, $3) RETURNING id`,
    [tenantId, JSON.stringify({ en: `ROV-384 ${tag}` }), SYSTEM],
  );
  const membership = await one(
    `INSERT INTO memberships (user_id, tenant_id, role_id, status, created_by, updated_by)
     VALUES ($1, $2, $3, 'ACTIVE', $4, $4) RETURNING id`,
    [userId, tenantId, roleId, SYSTEM],
  );
  const year = await one(
    `INSERT INTO academic_years (tenant_id, label, start_date, end_date, created_by, updated_by)
     VALUES ($1, '2031-32', '2031-04-01', '2032-03-31', $2, $2) RETURNING id`,
    [tenantId, SYSTEM],
  );
  const standard = await one(
    `INSERT INTO standards (tenant_id, academic_year_id, name, numeric_order, created_by, updated_by)
     VALUES ($1, $2, $3, 1, $4, $4) RETURNING id`,
    [tenantId, year, JSON.stringify({ en: 'Class 1' }), SYSTEM],
  );
  const section = await one(
    `INSERT INTO sections (tenant_id, standard_id, academic_year_id, name, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
    [tenantId, standard, year, JSON.stringify({ en: 'A' }), SYSTEM],
  );
  const student = await one(
    `INSERT INTO student_profiles
       (tenant_id, user_id, membership_id, admission_number, admission_date, created_by, updated_by)
     VALUES ($1, $2, $3, $4, '2031-04-01', $5, $5) RETURNING id`,
    [tenantId, userId, membership, `R384-${tag}`, SYSTEM],
  );
  return {
    resellerId,
    tenantId,
    userId,
    roleId,
    rows: {
      academic_years: year,
      memberships: membership,
      sections: section,
      standards: standard,
      student_profiles: student,
    },
  };
}

async function removeInstitute(client: pg.PoolClient, institute: Institute): Promise<void> {
  const { tenantId, userId, resellerId } = institute;
  for (const table of [
    'student_profiles',
    'sections',
    'standards',
    'academic_years',
    'memberships',
  ]) {
    await client.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await client.query('DELETE FROM roles WHERE tenant_id = $1', [tenantId]);
  await client.query('DELETE FROM users WHERE id = $1', [userId]);
  await client.query('DELETE FROM institutes WHERE id = $1', [tenantId]);
  await client.query('DELETE FROM roles WHERE reseller_id = $1', [resellerId]);
  await client.query('DELETE FROM resellers WHERE id = $1', [resellerId]);
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: TEST_SUPERUSER_URL, max: 1 });
  const client = await pool.connect();
  try {
    own = await createInstitute(client);
    other = await createInstitute(client);
  } finally {
    client.release();
  }
});

afterAll(async () => {
  const client = await pool.connect();
  try {
    if (own) await removeInstitute(client, own);
    if (other) await removeInstitute(client, other);
  } finally {
    client.release();
    await pool.end();
  }
});

/**
 * A scratch copy of `table`'s columns that carries one rule: the foreign key `constraint`,
 * with the definition the catalog holds for the real table. Gone when the transaction ends.
 */
async function copyWithOnlyThatKey(
  client: pg.PoolClient,
  table: string,
  constraint: string,
): Promise<void> {
  await client.query('CREATE SCHEMA same_tenant_key_scratch');
  await client.query(
    `CREATE TABLE same_tenant_key_scratch.copy (LIKE public.${table} INCLUDING DEFAULTS)`,
  );
  await client.query(`
    DO $do$
    DECLARE item record;
    BEGIN
      FOR item IN
        SELECT attname FROM pg_attribute
         WHERE attrelid = 'same_tenant_key_scratch.copy'::regclass AND attnum > 0 AND attnotnull
      LOOP
        EXECUTE format(
          'ALTER TABLE same_tenant_key_scratch.copy ALTER COLUMN %I DROP NOT NULL', item.attname);
      END LOOP;
    END
    $do$`);
  const { rows } = await client.query<{ definition: string }>(
    `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid = $1::regclass AND conname = $2 AND contype = 'f' AND convalidated`,
    [`public.${table}`, constraint],
  );
  expect(rows).toHaveLength(1);
  // Takes a lock on the referenced table that waits for its writers; it is held for an instant.
  await client.query(
    `ALTER TABLE same_tenant_key_scratch.copy ADD CONSTRAINT "${constraint}" ${rows[0].definition}`,
  );
  await client.query('GRANT USAGE ON SCHEMA same_tenant_key_scratch TO roviq_admin');
  await client.query('GRANT INSERT ON same_tenant_key_scratch.copy TO roviq_admin');
}

/** The ids of the two rows in the copied referenced table. */
interface CopiedParent {
  own: string;
  other: string;
}

/**
 * As `copyWithOnlyThatKey`, with the referenced table copied as well: `scratch.parent` holds
 * one row of each institute, and the key, with the columns and actions the catalog holds for
 * the real one, points at it.
 */
async function copyWithKeyToCopiedParent(
  client: pg.PoolClient,
  table: string,
  parent: string,
  constraint: string,
): Promise<CopiedParent> {
  await client.query('CREATE SCHEMA same_tenant_key_scratch');
  for (const [copy, source] of [
    ['copy', table],
    ['parent', parent],
  ]) {
    await client.query(
      `CREATE TABLE same_tenant_key_scratch.${copy} (LIKE public.${source} INCLUDING DEFAULTS)`,
    );
    await client.query(
      `DO $do$
       DECLARE item record;
       BEGIN
         FOR item IN
           SELECT attname FROM pg_attribute
            WHERE attrelid = 'same_tenant_key_scratch.${copy}'::regclass AND attnum > 0 AND attnotnull
         LOOP
           EXECUTE format(
             'ALTER TABLE same_tenant_key_scratch.${copy} ALTER COLUMN %I DROP NOT NULL', item.attname);
         END LOOP;
       END
       $do$`,
    );
  }
  await client.query('CREATE UNIQUE INDEX ON same_tenant_key_scratch.parent (id, tenant_id)');
  const ids = { own: randomUUID(), other: randomUUID() };
  await client.query(
    'INSERT INTO same_tenant_key_scratch.parent (id, tenant_id) VALUES ($1, $2), ($3, $4)',
    [ids.own, own.tenantId, ids.other, other.tenantId],
  );
  const { rows } = await client.query<{ definition: string }>(
    `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid = $1::regclass AND conname = $2 AND contype = 'f' AND convalidated`,
    [`public.${table}`, constraint],
  );
  expect(rows).toHaveLength(1);
  const references = `REFERENCES ${parent}(id, tenant_id)`;
  expect(rows[0].definition).toContain(references);
  await client.query(
    `ALTER TABLE same_tenant_key_scratch.copy ADD CONSTRAINT "${constraint}" ${rows[0].definition.replace(
      references,
      'REFERENCES same_tenant_key_scratch.parent(id, tenant_id)',
    )}`,
  );
  await client.query('GRANT USAGE ON SCHEMA same_tenant_key_scratch TO roviq_admin');
  await client.query('GRANT SELECT, INSERT ON same_tenant_key_scratch.copy TO roviq_admin');
  await client.query('GRANT SELECT, DELETE ON same_tenant_key_scratch.parent TO roviq_admin');
  return ids;
}

/** Runs `fn` in a transaction that is always rolled back; a lock that cannot be had is tried again. */
async function inScratchTx(fn: (client: pg.PoolClient) => Promise<void>): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL lock_timeout = '5s'`);
      await fn(client);
      return;
    } catch (error) {
      const code = error instanceof pg.DatabaseError ? error.code : undefined;
      // 55P03: lock not available
      if (code !== '55P03' || attempt === 3) throw error;
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }
}

describe('foreign keys between tenant tables', () => {
  it('lists every key that carries tenant_id, so each one is attempted below', async () => {
    const { rows } = await pool.query<{ key: string }>(`
      SELECT format('%s.%s -> %s (%s)', child.relname,
               (SELECT a.attname FROM unnest(con.conkey) k(n)
                  JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.n
                 WHERE a.attname <> 'tenant_id'),
               parent.relname, con.conname) AS key
        FROM pg_constraint con
        JOIN pg_class child ON child.oid = con.conrelid
        JOIN pg_class parent ON parent.oid = con.confrelid
       WHERE con.contype = 'f' AND con.connamespace = 'public'::regnamespace
         AND cardinality(con.conkey) = 2 AND con.convalidated
         AND EXISTS (SELECT 1 FROM unnest(con.conkey) k(n)
                       JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.n
                      WHERE a.attname = 'tenant_id')
         AND EXISTS (SELECT 1 FROM unnest(con.confkey) k(n)
                       JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.n
                      WHERE a.attname = 'tenant_id')
       ORDER BY 1`);
    const listed = [...SAME_TENANT_KEYS, ...KEYS_WITH_COPIED_PARENT, ...SET_NULL_KEYS]
      .map(([table, column, parent, name]) => `${table}.${column} -> ${parent} (${name})`)
      .sort();
    expect(rows.map((row) => row.key)).toEqual(listed);
  });

  it.each(
    SAME_TENANT_KEYS,
  )('%s.%s refuses a %s row of another institute', async (table, column, parent, constraint) => {
    const insert = `INSERT INTO same_tenant_key_scratch.copy (tenant_id, ${column}) VALUES ($1, $2)`;
    await inScratchTx(async (client) => {
      await copyWithOnlyThatKey(client, table, constraint);
      await client.query('SET LOCAL ROLE roviq_admin');

      await client.query('SAVEPOINT attempt');
      await expect(
        client.query(insert, [own.tenantId, other.rows[parent as Parent]]),
      ).rejects.toMatchObject({ code: '23503', constraint });
      await client.query('ROLLBACK TO SAVEPOINT attempt');

      // The same row naming its own institute's row is accepted: only the institute differed.
      await client.query(insert, [own.tenantId, own.rows[parent as Parent]]);
      // A reference that is not set is not checked.
      await client.query(insert, [own.tenantId, null]);
    });
  });

  it.each(
    KEYS_WITH_COPIED_PARENT,
  )('%s.%s refuses a %s row of another institute', async (table, column, parent, constraint) => {
    const insert = `INSERT INTO same_tenant_key_scratch.copy (tenant_id, ${column}) VALUES ($1, $2)`;
    await inScratchTx(async (client) => {
      const ids = await copyWithKeyToCopiedParent(client, table, parent, constraint);
      await client.query('SET LOCAL ROLE roviq_admin');

      await client.query('SAVEPOINT attempt');
      await expect(client.query(insert, [own.tenantId, ids.other])).rejects.toMatchObject({
        code: '23503',
        constraint,
      });
      await client.query('ROLLBACK TO SAVEPOINT attempt');

      await client.query(insert, [own.tenantId, ids.own]);
      await client.query(insert, [own.tenantId, null]);
    });
  });

  it.each(
    SET_NULL_KEYS,
  )('%s.%s refuses a %s row of another institute, and is cleared alone when its row is deleted', async (table, column, parent, constraint) => {
    const insert = `INSERT INTO same_tenant_key_scratch.copy (tenant_id, ${column}) VALUES ($1, $2)`;
    await inScratchTx(async (client) => {
      const ids = await copyWithKeyToCopiedParent(client, table, parent, constraint);
      await client.query('SET LOCAL ROLE roviq_admin');

      await client.query('SAVEPOINT attempt');
      await expect(client.query(insert, [own.tenantId, ids.other])).rejects.toMatchObject({
        code: '23503',
        constraint,
      });
      await client.query('ROLLBACK TO SAVEPOINT attempt');

      await client.query(insert, [own.tenantId, ids.own]);
      await client.query('DELETE FROM same_tenant_key_scratch.parent WHERE id = $1', [ids.own]);
      const { rows } = await client.query<{ tenant: string | null; reference: string | null }>(
        `SELECT tenant_id AS tenant, ${column} AS reference FROM same_tenant_key_scratch.copy`,
      );
      expect(rows).toEqual([{ tenant: own.tenantId, reference: null }]);
    });
  });
});
