// Runs ONCE before any integration test worker starts. Builds `roviq_test` from
// the migrations when it is empty or was built by another chain, then applies
// pending migrations to DATABASE_URL_TEST_MIGRATE, idempotently.
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ensureIntegrationInfra } from './scripts/int-infra';

export async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL_TEST_MIGRATE;
  if (!url) {
    throw new Error('DATABASE_URL_TEST_MIGRATE is not set; cannot prepare integration test DB');
  }

  await ensureIntegrationInfra(__dirname);

  const bootstrap = spawnSync('pnpm', ['run', 'db:reset', '--test', '--if-empty'], {
    stdio: 'inherit',
    cwd: __dirname,
    shell: false,
  });
  if (bootstrap.status !== 0) {
    throw new Error(
      `db:reset --test --if-empty failed (exit ${bootstrap.status}) — its output is above`,
    );
  }

  const result = spawnSync('drizzle-kit', ['migrate', '--config=drizzle.config.ts'], {
    stdio: 'inherit',
    cwd: resolve(__dirname, 'libs/database'),
    env: { ...process.env, DATABASE_URL_MIGRATE: url },
    shell: false,
  });

  if (result.status !== 0) {
    const target = new URL(url);
    // A pending migration can be refused by rows earlier runs left behind (a new foreign key or
    // CHECK that an old fixture breaks). The test database holds nothing but seed data, so it
    // is rebuilt once; a migration that fails on an empty database fails here again.
    console.warn(
      `drizzle-kit migrate failed (exit ${result.status}) against ${target.host}${target.pathname}; rebuilding the test database`,
    );
    const rebuild = spawnSync('pnpm', ['run', 'db:reset', '--test'], {
      stdio: 'inherit',
      cwd: __dirname,
      shell: false,
    });
    if (rebuild.status !== 0) {
      throw new Error(
        `drizzle-kit migrate failed against ${target.host}${target.pathname}, and so did the rebuild (exit ${rebuild.status}) — the output is above`,
      );
    }
  }
}
