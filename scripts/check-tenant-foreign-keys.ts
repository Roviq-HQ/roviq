/**
 * CI guard: a foreign key between two tables that carry `tenant_id` holds the institute, so
 * PostgreSQL refuses a row that names another institute's row, whichever role writes it.
 *
 * - The referenced table's `tenant_id` is never NULL: the key includes `tenant_id`
 *   (`sameTenantForeignKey()`, or a `SET NULL (column)` key in custom SQL).
 * - The referenced table's `tenant_id` may be NULL (a system role, a platform sender, a
 *   person's file): the key is one column, declared with `sameTenantOrNoneForeignKey()`, and a
 *   custom SQL migration adds the two triggers that accept a referenced row of the same
 *   institute or of none.
 *
 * Both helpers are in `libs/database/src/schema/common/columns.ts`. No key is exempt.
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
  /** The constraint's name in the schema, when it was given one. */
  constraint: string | undefined;
  table: string;
  /** The referencing columns other than `tenant_id`, joined with a comma. */
  column: string;
  parent: string;
  /** The referenced table's `tenant_id` may be NULL. */
  parentTenantOptional: boolean;
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

export function tenantKeysOf(tables: readonly PgTable[]): TenantKey[] {
  const tenantColumn = (table: PgTable) =>
    getTableConfig(table).columns.find((column) => column.name === 'tenant_id');
  const keys: TenantKey[] = [];
  for (const table of tables) {
    const config = getTableConfig(table);
    if (!tenantColumn(table)) continue;
    for (const foreignKey of config.foreignKeys) {
      const reference = foreignKey.reference();
      const parentTenant = tenantColumn(reference.foreignTable);
      if (!parentTenant) continue;
      const columns = reference.columns.map((column) => column.name);
      const own = columns.filter((column) => column !== 'tenant_id').join(',');
      const parent = getTableConfig(reference.foreignTable).name;
      keys.push({
        name: `${config.name}.${own} -> ${parent}`,
        carriesTenant: columns.includes('tenant_id'),
        constraint: reference.name,
        table: config.name,
        column: own,
        parent,
        parentTenantOptional: !parentTenant.notNull,
      });
    }
  }
  return keys.sort((a, b) => a.name.localeCompare(b.name));
}

/** The name `sameTenantOrNoneForeignKey()` is given for a key, and its trigger's name. */
export const orNoneKeyName = (key: Pick<TenantKey, 'table' | 'column'>): string =>
  `${key.table}_${key.column}_tenant_or_none_fkey`;
export const orNoneTriggerName = (key: Pick<TenantKey, 'table' | 'column'>): string =>
  `${key.table}_${key.column}_tenant_or_none`;

/** The two statements a custom SQL migration must hold for a same-tenant-or-none key. */
export function orNoneStatements(key: Pick<TenantKey, 'table' | 'column' | 'parent'>): string[] {
  return [
    `CREATE TRIGGER "${orNoneTriggerName(key)}" AFTER INSERT OR UPDATE ON "${key.table}" ` +
      // No closing bracket: a key may add the scope its referenced rows must have.
      `FOR EACH ROW EXECUTE FUNCTION check_same_tenant_or_none('${key.column}', '${key.parent}'`,
    `CREATE TRIGGER "${key.parent}_keep_referenced_tenant" BEFORE UPDATE ON "${key.parent}" ` +
      'FOR EACH ROW WHEN (OLD.tenant_id IS DISTINCT FROM NEW.tenant_id) ' +
      'EXECUTE FUNCTION keep_referenced_tenant();',
  ];
}

/**
 * Problems with the one-column keys between two tenant tables. Each must be a
 * same-tenant-or-none key: named by the helper, pointing at a table whose `tenant_id` may be
 * NULL, with both triggers added by a migration and dropped by none.
 */
export function checkTenantKeys(keys: readonly TenantKey[], migrationsSql: string): string[] {
  const problems: string[] = [];
  for (const key of keys) {
    if (key.carriesTenant) continue;
    if (!key.parentTenantOptional) {
      problems.push(
        `${key.name}: the key does not include tenant_id. Declare it with sameTenantForeignKey() and give "${key.parent}" a unique index on (id, tenant_id); an ON DELETE SET NULL reference goes in SET_NULL_KEYS_IN_CUSTOM_SQL with a custom SQL migration instead`,
      );
      continue;
    }
    if (key.constraint !== orNoneKeyName(key)) {
      problems.push(
        `${key.name}: "${key.parent}" rows may belong to no institute. Declare the key with sameTenantOrNoneForeignKey('${orNoneKeyName(key)}', …)`,
      );
    }
    for (const statement of orNoneStatements(key)) {
      if (!migrationsSql.includes(statement)) {
        problems.push(`${key.name}: no migration holds\n      ${statement}`);
      }
    }
    for (const trigger of [orNoneTriggerName(key), `${key.parent}_keep_referenced_tenant`]) {
      if (new RegExp(`DROP TRIGGER (IF EXISTS )?"?${trigger}"?`).test(migrationsSql)) {
        problems.push(`${key.name}: a migration drops the trigger ${trigger}`);
      }
    }
  }
  return problems;
}

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
  const migrationsSql = readMigrationsSql();
  const plain = checkTenantKeys(keys, migrationsSql);
  const setNull = checkSetNullKeys(tables, migrationsSql);
  if (plain.length === 0 && setNull.length === 0) {
    const converted = keys.filter((key) => key.carriesTenant).length;
    process.stdout.write(
      `check:tenant-foreign-keys OK (${converted} keys carry tenant_id in the schema, ${SET_NULL_KEYS_IN_CUSTOM_SQL.length} in custom SQL, ${keys.length - converted} are same-tenant-or-none keys held by triggers)\n`,
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
  if (plain.length > 0) {
    process.stderr.write(
      `check:tenant-foreign-keys: ${plain.length} problem(s) with foreign keys between two tenant tables:\n\n`,
    );
    for (const problem of plain) process.stderr.write(`  ${problem}\n`);
  }
  return 1;
}

if (process.argv[1]?.endsWith('check-tenant-foreign-keys.ts')) {
  main().then((code) => process.exit(code));
}
