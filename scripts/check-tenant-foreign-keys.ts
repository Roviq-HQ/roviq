/**
 * CI guard: a foreign key between two tables that carry `tenant_id` includes `tenant_id`, so
 * PostgreSQL refuses a row that names another institute's row, whichever role writes it.
 * Declare one with `sameTenantForeignKey()` (`libs/database/src/schema/common/columns.ts`).
 *
 * A key that cannot carry it is listed below with its reason. The list only shrinks: an entry
 * whose key is gone or now carries `tenant_id` fails the check until it is removed.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';

/** `child.column -> parent` */
export type KeyName = string;

export interface TenantKey {
  name: KeyName;
  /** The key's own columns include `tenant_id`. */
  carriesTenant: boolean;
}

export interface SetNullKey {
  table: string;
  column: string;
  parent: string;
}

/**
 * `ON DELETE SET NULL` references. A key that carries `tenant_id` would set `tenant_id` to
 * NULL as well; PostgreSQL's `SET NULL (column)` form avoids that, and Drizzle cannot declare
 * it. So the schema declares no reference for these columns, and a custom SQL migration adds
 * the key `<table>_<column>_tenant_fkey`. The check reads both: the schema must stay silent and
 * a migration must hold the statement.
 */
export const SET_NULL_KEYS_IN_CUSTOM_SQL: readonly SetNullKey[] = [
  { table: 'attendance_sessions', column: 'subject_id', parent: 'subjects' },
  { table: 'co_scholastic_areas', column: 'grading_scheme_id', parent: 'grading_schemes' },
  { table: 'exam_schedules', column: 'invigilator_id', parent: 'memberships' },
  { table: 'exams', column: 'exam_term_id', parent: 'exam_terms' },
  { table: 'exams', column: 'grading_scheme_id', parent: 'grading_schemes' },
  { table: 'leaves', column: 'decided_by', parent: 'memberships' },
  { table: 'report_card_instances', column: 'section_id', parent: 'sections' },
  { table: 'report_cards', column: 'exam_term_id', parent: 'exam_terms' },
  { table: 'report_cards', column: 'grading_scheme_id', parent: 'grading_schemes' },
  { table: 'sections', column: 'class_teacher_id', parent: 'memberships' },
  { table: 'timetable_day_overrides', column: 'subject_id', parent: 'subjects' },
  { table: 'timetable_day_overrides', column: 'teacher_id', parent: 'memberships' },
  { table: 'timetable_entries', column: 'subject_id', parent: 'subjects' },
  { table: 'timetable_entries', column: 'teacher_id', parent: 'memberships' },
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

export const LISTED: readonly KeyName[] = Object.keys(EXCLUDED);

/** The statement a custom SQL migration must hold for a `SET NULL (column)` key. */
export function setNullStatement(key: SetNullKey): string {
  const name = `${key.table}_${key.column}_tenant_fkey`;
  return (
    `ALTER TABLE "${key.table}" ADD CONSTRAINT "${name}" FOREIGN KEY ("${key.column}","tenant_id") ` +
    `REFERENCES "${key.parent}"("id","tenant_id") ON DELETE SET NULL ("${key.column}")`
  );
}

/**
 * Problems with the `SET NULL (column)` keys: the schema declares a reference for the column
 * (drizzle-kit would then own a second key), the column is gone, or no migration adds the key.
 */
export function checkSetNullKeys(
  tables: readonly PgTable[],
  migrationsSql: string,
  keys: readonly SetNullKey[] = SET_NULL_KEYS_IN_CUSTOM_SQL,
): string[] {
  const problems: string[] = [];
  for (const key of keys) {
    const label = `${key.table}.${key.column} -> ${key.parent}`;
    const table = tables.find((candidate) => getTableConfig(candidate).name === key.table);
    const config = table ? getTableConfig(table) : undefined;
    if (!config?.columns.some((column) => column.name === key.column)) {
      problems.push(`${label}: the column is not in the schema; remove the entry`);
      continue;
    }
    const declared = config.foreignKeys.some((foreignKey) =>
      foreignKey.reference().columns.some((column) => column.name === key.column),
    );
    if (declared) {
      problems.push(
        `${label}: the schema declares a reference; the custom SQL key is the only one`,
      );
    }
    if (!migrationsSql.includes(setNullStatement(key))) {
      problems.push(`${label}: no migration holds\n      ${setNullStatement(key)}`);
    }
    if (migrationsSql.includes(`DROP CONSTRAINT "${key.table}_${key.column}_tenant_fkey"`)) {
      problems.push(`${label}: a migration drops the key`);
    }
  }
  return problems;
}

function readMigrationsSql(): string {
  const dir = join(__dirname, '..', 'libs', 'database', 'migrations');
  return readdirSync(dir)
    .map((folder) => join(dir, folder, 'migration.sql'))
    .filter((file) => existsSync(file))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
}

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
  const setNull = checkSetNullKeys(tables, readMigrationsSql());
  if (unlisted.length === 0 && stale.length === 0 && setNull.length === 0) {
    const converted = keys.filter((key) => key.carriesTenant).length;
    process.stdout.write(
      `check:tenant-foreign-keys OK (${converted} keys carry tenant_id in the schema, ${SET_NULL_KEYS_IN_CUSTOM_SQL.length} in custom SQL, ${LISTED.length} excluded with a reason)\n`,
    );
    return 0;
  }
  if (setNull.length > 0) {
    process.stderr.write(
      `check:tenant-foreign-keys: ${setNull.length} problem(s) with the SET NULL (column) keys:\n\n`,
    );
    for (const problem of setNull) process.stderr.write(`  ${problem}\n`);
    process.stderr.write('\n');
  }
  if (unlisted.length > 0) {
    process.stderr.write(
      `check:tenant-foreign-keys: ${unlisted.length} foreign key(s) between two tenant tables do not include tenant_id.\n` +
        'Declare each with sameTenantForeignKey() and give the referenced table a unique index on (id, tenant_id).\n' +
        'An ON DELETE SET NULL reference goes in SET_NULL_KEYS_IN_CUSTOM_SQL with a custom SQL migration instead:\n\n',
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
