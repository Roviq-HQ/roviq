/**
 * `pnpm db:migrate` checks its role first (ROV-396). This spec reads the rights of two real
 * roles through the same query the check uses.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationRoleProblems, readMigrationRole } from '../../../../scripts/check-migration-role';
import { TEST_SUPERUSER_URL } from './test-helpers';

let pool: pg.Pool;

beforeAll(() => {
  pool = new pg.Pool({ connectionString: TEST_SUPERUSER_URL, max: 1 });
});

afterAll(async () => {
  await pool.end();
});

describe('the migration role check', () => {
  it('should find the owner role fit to run the migrations', async () => {
    const role = await readMigrationRole(pool, undefined);
    expect(migrationRoleProblems(role, undefined)).toEqual([]);
  });

  it('should find the institute role unfit, with or without an administrative role named', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE roviq_app');
      const plain = await readMigrationRole(client, undefined);
      expect(plain).toMatchObject({ name: 'roviq_app', superuser: false });
      expect(migrationRoleProblems(plain, undefined)).toHaveLength(1);

      const named = await readMigrationRole(client, 'roviq_admin');
      expect(named).toMatchObject({ inAdminRole: false, createRole: false, bypassRls: false });
      expect(migrationRoleProblems(named, 'roviq_admin')).toHaveLength(3);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
