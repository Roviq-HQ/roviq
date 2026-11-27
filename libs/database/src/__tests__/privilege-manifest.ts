/**
 * Reads what the application roles may do, as lines that can be compared with
 * `libs/database/privileges.manifest.txt`.
 *
 * - `grant  | role | table | COMMAND | *`            a table privilege
 * - `grant  | role | table | COMMAND | col, col`     a privilege on those columns only
 * - `view   | role | view  | COMMAND`                a privilege on a view
 * - `policy | table | name | roles | COMMAND | using: … | check: …`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type pg from 'pg';

export const MANIFEST_PATH = join(__dirname, '..', '..', 'privileges.manifest.txt');

/** The roles a request, a consumer or the pool can act as. The platform role is not listed. */
export const MANIFEST_ROLES = [
  'roviq_app',
  'roviq_reseller',
  'roviq_user',
  'roviq_audit_writer',
  'roviq_pooler',
] as const;

const HEADER = [
  '# What each application role may do in the database, and every row policy.',
  '# Compared with the database by privilege-manifest.integration.spec.ts, in both directions.',
  '# A migration that grants, revokes or changes a policy edits this file in the same change:',
  '#   UPDATE_PRIVILEGE_MANIFEST=1 pnpm vitest run --project integration privilege-manifest',
  '# then read the diff: every added line is an access somebody now has.',
];

const oneLine = (text: string | null): string => (text ?? '').replace(/\s+/g, ' ').trim();

export async function collectPrivileges(client: pg.ClientBase): Promise<string[]> {
  const roles = [...MANIFEST_ROLES];
  const lines: string[] = [];

  const tableGrants = await client.query<{
    grantee: string;
    table_name: string;
    privilege_type: string;
    relkind: string;
  }>(
    `SELECT g.grantee, g.table_name, g.privilege_type, c.relkind
       FROM information_schema.role_table_grants g
       JOIN pg_class c ON c.relname = g.table_name
       JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = g.table_schema
      WHERE g.table_schema = 'public' AND g.grantee = ANY($1)`,
    [roles],
  );
  for (const row of tableGrants.rows) {
    lines.push(
      row.relkind === 'v'
        ? `view   | ${row.grantee} | ${row.table_name} | ${row.privilege_type}`
        : `grant  | ${row.grantee} | ${row.table_name} | ${row.privilege_type} | *`,
    );
  }

  const columnGrants = await client.query<{
    grantee: string;
    table_name: string;
    privilege_type: string;
    columns: string;
  }>(
    `SELECT cp.grantee, cp.table_name, cp.privilege_type,
            string_agg(cp.column_name, ', ' ORDER BY cp.column_name) AS columns
       FROM information_schema.column_privileges cp
      WHERE cp.table_schema = 'public' AND cp.grantee = ANY($1)
        AND NOT EXISTS (
          SELECT 1 FROM information_schema.role_table_grants t
           WHERE t.table_schema = 'public' AND t.grantee = cp.grantee
             AND t.table_name = cp.table_name AND t.privilege_type = cp.privilege_type
        )
      GROUP BY cp.grantee, cp.table_name, cp.privilege_type`,
    [roles],
  );
  for (const row of columnGrants.rows) {
    lines.push(
      `grant  | ${row.grantee} | ${row.table_name} | ${row.privilege_type} | ${row.columns}`,
    );
  }

  const policies = await client.query<{
    tablename: string;
    policyname: string;
    roles: string;
    cmd: string;
    qual: string | null;
    with_check: string | null;
  }>(
    `SELECT tablename, policyname, array_to_string(roles, ', ') AS roles, cmd, qual, with_check
       FROM pg_policies WHERE schemaname = 'public'`,
  );
  for (const row of policies.rows) {
    lines.push(
      `policy | ${row.tablename} | ${row.policyname} | ${row.roles} | ${row.cmd} | using: ${oneLine(row.qual)} | check: ${oneLine(row.with_check)}`,
    );
  }

  return lines.sort();
}

export function readManifest(): string[] {
  return readFileSync(MANIFEST_PATH, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

export function writeManifest(lines: string[]): void {
  writeFileSync(MANIFEST_PATH, `${[...HEADER, ...lines].join('\n')}\n`);
}

export interface ManifestDiff {
  /** In the database, not in the file: an access nobody wrote down. */
  onlyInDatabase: string[];
  /** In the file, not in the database: an access the file promises and the database lacks. */
  onlyInManifest: string[];
}

export function diffManifest(database: string[], manifest: string[]): ManifestDiff {
  const inFile = new Set(manifest);
  const inDatabase = new Set(database);
  return {
    onlyInDatabase: database.filter((line) => !inFile.has(line)),
    onlyInManifest: manifest.filter((line) => !inDatabase.has(line)),
  };
}

export function describeDiff(diff: ManifestDiff): string {
  return [
    'The database and libs/database/privileges.manifest.txt disagree.',
    ...diff.onlyInDatabase.map((line) => `  + in the database only: ${line}`),
    ...diff.onlyInManifest.map((line) => `  - in the manifest only: ${line}`),
    'If the change is meant, update the file (see its header) and review the diff.',
  ].join('\n');
}
