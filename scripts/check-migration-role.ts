// Run before `drizzle-kit migrate`: the migrations create roles, event triggers and row
// policies, and a role that lacks one of these rights fails part-way through the chain with a
// message that does not say what to change. Rule in words: docs/deployment.md → "Database
// migrations".
// Run with plain `node` (it strips the types): the migrator image downloads nothing at run time.
import 'dotenv/config';
import pg from 'pg';

export interface MigrationRole {
  name: string;
  superuser: boolean;
  createRole: boolean;
  bypassRls: boolean;
  /** Member, directly or through other roles, of the role named in MIGRATION_ADMIN_ROLE. */
  inAdminRole: boolean;
}

/** What `role` lacks to run the migrations; empty when it can. */
export function migrationRoleProblems(
  role: MigrationRole,
  adminRole: string | undefined,
): string[] {
  if (role.superuser) return [];
  if (!adminRole) {
    return [
      `Role "${role.name}" is not a superuser. The migrations create event triggers, which ` +
        'PostgreSQL allows only to a superuser. Connect DATABASE_URL_MIGRATE as one. On a ' +
        'managed PostgreSQL that has no superusers, set MIGRATION_ADMIN_ROLE to the ' +
        'administrative role the service provides and make this role a member of it.',
    ];
  }
  const problems: string[] = [];
  if (!role.inAdminRole) {
    problems.push(
      `Role "${role.name}" is not a member of "${adminRole}" (MIGRATION_ADMIN_ROLE), which the ` +
        `migrations need to create event triggers: GRANT "${adminRole}" TO "${role.name}".`,
    );
  }
  if (!role.createRole) {
    problems.push(
      `Role "${role.name}" may not create roles, and the migrations create the application ` +
        `roles: ALTER ROLE "${role.name}" CREATEROLE.`,
    );
  }
  if (!role.bypassRls) {
    problems.push(
      `Role "${role.name}" is subject to row security, so a migration that moves data would ` +
        `see no rows: ALTER ROLE "${role.name}" BYPASSRLS.`,
    );
  }
  return problems;
}

interface Queryable {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

/** The rights of the role this connection acts as. */
export async function readMigrationRole(
  client: Queryable,
  adminRole: string | undefined,
): Promise<MigrationRole> {
  const { rows } = await client.query(
    `SELECT r.rolname AS name, r.rolsuper AS superuser, r.rolcreaterole AS create_role,
            r.rolbypassrls AS bypass_rls,
            COALESCE((SELECT pg_has_role(current_user, a.oid, 'MEMBER')
                        FROM pg_roles a WHERE a.rolname = $1), false) AS in_admin_role
       FROM pg_roles r WHERE r.rolname = current_user`,
    [adminRole ?? ''],
  );
  const row = rows[0];
  if (!row) throw new Error('The connection has no role in pg_roles');
  return {
    name: String(row.name),
    superuser: row.superuser === true,
    createRole: row.create_role === true,
    bypassRls: row.bypass_rls === true,
    inAdminRole: row.in_admin_role === true,
  };
}

async function main(): Promise<number> {
  const connectionString = process.env.DATABASE_URL_MIGRATE;
  if (!connectionString) {
    process.stderr.write('check-migration-role — DATABASE_URL_MIGRATE is not set.\n');
    return 1;
  }
  const adminRole = process.env.MIGRATION_ADMIN_ROLE || undefined;
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const role = await readMigrationRole(client, adminRole);
    const problems = migrationRoleProblems(role, adminRole);
    if (problems.length === 0) return 0;
    process.stderr.write('check-migration-role — this role cannot run the migrations:\n\n');
    for (const problem of problems) process.stderr.write(`  ${problem}\n`);
    process.stderr.write('\nNothing was changed in the database.\n');
    return 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith('check-migration-role.ts')) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(
        `check-migration-role — ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(1);
    },
  );
}
