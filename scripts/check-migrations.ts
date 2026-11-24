// CI guard — the migration chain builds an empty database and matches the Drizzle schema.
//
// 1. `drizzle-kit migrate` on an empty PostgreSQL 18 (a throwaway container with no init
//    script, as on a first production deploy) must succeed.
// 2. Every table it leaves must have row security enabled and forced: nothing else forces
//    it, so a migration that adds a table without FORCE would ship an owner bypass.
// 3. `drizzle-kit generate` must find nothing to generate: a schema change without a
//    migration reaches no database.

import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';

// Run from the repository root, like every check:* script.
const DATABASE_DIR = resolve(process.cwd(), 'libs', 'database');
const MIGRATIONS_DIR = join(DATABASE_DIR, 'migrations');

const IMAGE = 'postgres:18-alpine';
const CONTAINER = `migration-check-${process.pid}`;
const PASSWORD = 'migration_check';
const READY_TIMEOUT_MS = 60_000;

function docker(...args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8' }).trim();
}

function removeContainer(): void {
  spawnSync('docker', ['rm', '-f', '-v', CONTAINER], { stdio: 'ignore' });
}

function startDatabase(): string {
  docker(
    'run',
    '-d',
    '--name',
    CONTAINER,
    '-e',
    'POSTGRES_USER=roviq',
    '-e',
    `POSTGRES_PASSWORD=${PASSWORD}`,
    '-e',
    'POSTGRES_DB=roviq',
    // Docker picks a free port, so parallel instances never collide.
    '-p',
    '127.0.0.1::5432',
    '--tmpfs',
    '/var/lib/postgresql',
    IMAGE,
  );
  const hostPort = docker('port', CONTAINER, '5432/tcp').split('\n')[0]?.split(':').pop();
  if (!hostPort) {
    throw new Error('docker did not publish a port for the check database');
  }
  return `postgresql://roviq:${PASSWORD}@127.0.0.1:${hostPort}/roviq`;
}

// The image starts PostgreSQL twice (once to initialise), so only a real query proves it is up.
async function waitUntilReady(url: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      await client.query('SELECT 1');
      return;
    } catch (error) {
      if (Date.now() > deadline) {
        throw new Error(`the check database did not start: ${(error as Error).message}`);
      }
      await new Promise((done) => setTimeout(done, 500));
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}

function drizzleKit(url: string, args: string[]): { ok: boolean; output: string } {
  const result = spawnSync('pnpm', ['exec', 'drizzle-kit', ...args, '--config=drizzle.config.ts'], {
    cwd: DATABASE_DIR,
    encoding: 'utf8',
    // No terminal: a rename question from drizzle-kit fails instead of waiting for an answer.
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ROVIQ_EE: 'true', DATABASE_URL: url, DATABASE_URL_MIGRATE: url },
  });
  return { ok: result.status === 0, output: `${result.stdout}${result.stderr}` };
}

function migrationFolders(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function tablesWithoutForcedRls(url: string): Promise<string[]> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ name: string }>(`
      SELECT c.relname AS name
        FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace
         AND c.relkind IN ('r', 'p')
         AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
       ORDER BY 1
    `);
    return rows.map((row) => row.name);
  } finally {
    await client.end();
  }
}

async function check(): Promise<string[]> {
  const url = startDatabase();
  await waitUntilReady(url);

  const migrate = drizzleKit(url, ['migrate']);
  if (!migrate.ok) {
    return [`drizzle-kit migrate failed on an empty database:\n${migrate.output}`];
  }

  const failures: string[] = [];
  const unforced = await tablesWithoutForcedRls(url);
  if (unforced.length > 0) {
    failures.push(
      `Tables without ENABLE and FORCE ROW LEVEL SECURITY after migrating: ${unforced.join(', ')}.\n` +
        'Add `ALTER TABLE <table> FORCE ROW LEVEL SECURITY;` to the migration that creates each.',
    );
  }

  const before = migrationFolders();
  const generate = drizzleKit(url, ['generate', '--name=check-migrations']);
  const created = migrationFolders().filter((folder) => !before.includes(folder));
  for (const folder of created) {
    rmSync(join(MIGRATIONS_DIR, folder), { recursive: true, force: true });
  }
  if (!generate.ok) {
    failures.push(`drizzle-kit generate failed:\n${generate.output}`);
  } else if (created.length > 0) {
    failures.push(
      'The Drizzle schema has changes that no migration carries. ' +
        'Run `pnpm db:generate` and commit the new folder in libs/database/migrations.',
    );
  }
  return failures;
}

async function main(): Promise<void> {
  process.on('SIGINT', () => {
    removeContainer();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    removeContainer();
    process.exit(143);
  });

  let failures: string[];
  try {
    failures = await check();
  } finally {
    removeContainer();
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`✗ ${failure}\n`);
    }
    process.exit(1);
  }
  console.log(
    '✓ The migration chain builds an empty database, forces row security on every table, and matches the Drizzle schema.',
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
