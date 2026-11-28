/**
 * A reseller reads about a person only what its own screens show: the account (`users`), and
 * the name, picture and search text of the account profile (ROV-391, ROV-392). The reseller
 * role holds no privilege on the other person tables and a column list on `user_profiles`;
 * this spec attempts each read as the role.
 *
 * PostgreSQL checks a privilege before it looks at any row, so no fixture is needed.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asInstitute, asReseller, expectRefused, inRolledBackTx } from './role-helpers';
import { TEST_POOLER_URL } from './test-helpers';

const NOBODY = '00000000-0000-0000-0000-00000000dead';
const DENIED = /permission denied/;

/** Person tables no reseller code reads: the role holds no privilege on them at all. */
const CLOSED_TABLES = [
  // A person's details.
  'tenant_user_profiles',
  'user_addresses',
  'user_documents',
  'user_document_files',
  'user_identifiers',
  'phone_numbers',
  // A person's place in an institute.
  'student_profiles',
  'staff_profiles',
  'staff_qualifications',
  'guardian_profiles',
  'student_guardian_links',
  // Admission.
  'enquiries',
  'admission_applications',
  'application_documents',
  'application_document_files',
  // A person's records in an institute.
  'student_academics',
  'attendance_entries',
  'exam_marks',
  'co_scholastic_assessments',
  'report_card_instances',
  'issued_certificates',
  'tc_register',
  'leaves',
  'leave_files',
  'consent_records',
] as const;

/** The closed tables that have no `*_live` view. */
const CLOSED_WITHOUT_VIEW: ReadonlySet<string> = new Set(['consent_records']);

/** The columns of `user_profiles` the reseller role may read, and those it may not. */
const PROFILE_READABLE = [
  'id',
  'user_id',
  'first_name',
  'last_name',
  'profile_image_file_id',
  'search_vector',
  'deleted_at',
] as const;
const PROFILE_WITHHELD = [
  'gender',
  'date_of_birth',
  'blood_group',
  'religion',
  'nationality',
  'mother_tongue',
  'cover_image_url',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
  'deleted_by',
  'version',
] as const;

/** What an institute still reads about its own people: sensitive columns of each kind. */
const INSTITUTE_READS: ReadonlyArray<[table: string, column: string]> = [
  ['student_profiles', 'caste'],
  ['student_profiles', 'medical_info'],
  ['staff_profiles', 'disability_type'],
  ['guardian_profiles', 'annual_income'],
  ['tenant_user_profiles', 'religion'],
  ['tenant_user_profiles', 'date_of_birth'],
  ['user_profiles', 'religion'],
  ['user_profiles', 'blood_group'],
  ['user_identifiers', 'value_masked'],
  ['user_addresses', 'line1'],
  ['user_documents', 'reference_number'],
  ['phone_numbers', 'number'],
  ['enquiries', 'parent_phone'],
  ['admission_applications', 'form_data'],
  ['student_academics', 'roll_number'],
  ['leaves', 'reason'],
];

let pool: pg.Pool;

beforeAll(() => {
  pool = new pg.Pool({ connectionString: TEST_POOLER_URL, max: 2 });
});

afterAll(async () => {
  await pool.end();
});

describe('person tables a reseller does not read', () => {
  it.each(CLOSED_TABLES)('should refuse counting the rows of %s', async (table) => {
    await inRolledBackTx(pool, async (client) => {
      await asReseller(client, NOBODY);
      await expectRefused(client, DENIED, `SELECT count(*) FROM ${table}`);
    });
  });

  it.each(CLOSED_TABLES)('should refuse reading a row of %s', async (table) => {
    await inRolledBackTx(pool, async (client) => {
      await asReseller(client, NOBODY);
      await expectRefused(client, DENIED, `SELECT * FROM ${table}`);
    });
  });

  it.each(
    CLOSED_TABLES.filter((table) => !CLOSED_WITHOUT_VIEW.has(table)),
  )('should refuse reading %s through its view', async (table) => {
    await inRolledBackTx(pool, async (client) => {
      await asReseller(client, NOBODY);
      await expectRefused(client, DENIED, `SELECT count(*) FROM ${table}_live`);
    });
  });
});

describe('what a reseller may read of an account profile', () => {
  it.each(PROFILE_WITHHELD)('should refuse reading user_profiles.%s', async (column) => {
    await inRolledBackTx(pool, async (client) => {
      await asReseller(client, NOBODY);
      await expectRefused(client, DENIED, `SELECT ${column} FROM user_profiles`);
    });
  });

  it.each(PROFILE_WITHHELD)('should refuse filtering user_profiles by %s', async (column) => {
    await inRolledBackTx(pool, async (client) => {
      await asReseller(client, NOBODY);
      await expectRefused(
        client,
        DENIED,
        `SELECT id FROM user_profiles WHERE ${column} IS NOT NULL`,
      );
    });
  });

  it('should refuse reading the whole row, also through the view', async () => {
    await inRolledBackTx(pool, async (client) => {
      await asReseller(client, NOBODY);
      await expectRefused(client, DENIED, 'SELECT * FROM user_profiles');
      await expectRefused(client, DENIED, 'SELECT id FROM user_profiles_live');
    });
  });

  it('should still let it read the name, the picture and the search text', async () => {
    await inRolledBackTx(pool, async (client) => {
      await asReseller(client, NOBODY);
      const res = await client.query(
        `SELECT ${PROFILE_READABLE.join(', ')} FROM user_profiles WHERE deleted_at IS NULL`,
      );
      expect(res.rows).toEqual([]);
    });
  });

  it('should hold exactly the listed columns of user_profiles', async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      // The catalog, not information_schema: that view lists only what the login role may use.
      `SELECT attname AS column_name FROM pg_attribute
        WHERE attrelid = 'public.user_profiles'::regclass AND attnum > 0 AND NOT attisdropped
          AND has_column_privilege('roviq_reseller', attrelid, attnum, 'SELECT')
        ORDER BY attname`,
    );
    expect(rows.map((row) => row.column_name)).toEqual([...PROFILE_READABLE].sort());
  });

  it('should still let it read the account through its view', async () => {
    await inRolledBackTx(pool, async (client) => {
      await asReseller(client, NOBODY);
      const res = await client.query('SELECT id, username, email, status FROM users_live');
      expect(res.rows).toEqual([]);
    });
  });
});

describe('what an institute may read about its own people', () => {
  it.each(INSTITUTE_READS)('should still let it read %s.%s', async (table, column) => {
    await inRolledBackTx(pool, async (client) => {
      await asInstitute(client, NOBODY);
      const res = await client.query(`SELECT ${column} FROM ${table}_live`);
      expect(res.rows).toEqual([]);
    });
  });
});
