import assert from 'node:assert';
import { createDrizzleDb } from '@roviq/database';
import { withTestContext } from '@roviq/request-context';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED } from '../../../../../../e2e/shared/seed-fixtures';
import { PlanRepository } from '../../../../../../ee/apps/api-gateway/src/billing/repositories/plan.repository';
import {
  TEST_POOLER_URL,
  TEST_SUPERUSER_URL,
} from '../../../../../../libs/database/src/__tests__/test-helpers';
import { InstituteRoleDrizzleRepository } from '../../../auth/role/repositories/role.drizzle-repository';
import { SectionDrizzleRepository } from '../../section/repositories/section.drizzle-repository';
import { InstituteDrizzleRepository } from '../repositories/institute.drizzle-repository';

let admin: pg.Pool;
let runtime: pg.Pool;
beforeAll(() => {
  admin = new pg.Pool({ connectionString: TEST_SUPERUSER_URL, max: 2 });
  runtime = new pg.Pool({ connectionString: TEST_POOLER_URL, max: 2 });
});
afterAll(async () => {
  await admin.end();
  await runtime.end();
});

interface NamedRow {
  id: string;
  name: Record<string, string>;
}

describe('multilingual repository searches', () => {
  it('finds institutes using their Hindi name', async () => {
    const repo = new InstituteDrizzleRepository(createDrizzleDb(runtime));
    const records = await repo.searchByName(SEED.INSTITUTE_1.nameHi);
    expect(records.map((record) => record.id)).toContain(SEED.INSTITUTE_1.id);
  });
  it('finds roles within the current institute and excludes other institutes', async () => {
    const { rows } = await admin.query<NamedRow>(
      `SELECT id,name FROM roles_live WHERE tenant_id=$1 AND scope='institute' ORDER BY id LIMIT 1`,
      [SEED.INSTITUTE_1.id],
    );
    const row = rows[0];
    assert(row);
    const query = row.name.hi || row.name.en;
    const repo = new InstituteRoleDrizzleRepository(createDrizzleDb(runtime));
    const records = await withTestContext(() => repo.searchByName(query), {
      tenantId: SEED.INSTITUTE_1.id,
    });
    expect(records.map((record) => record.id)).toContain(row.id);
    expect(records.every((record) => record.tenantId === SEED.INSTITUTE_1.id)).toBe(true);
    const other = await withTestContext(() => repo.searchByName(query), {
      tenantId: SEED.INSTITUTE_2.id,
    });
    expect(other.map((record) => record.id)).not.toContain(row.id);
  });
  it('finds sections within the current institute and excludes other institutes', async () => {
    const { rows } = await admin.query<NamedRow>(
      `SELECT id,name FROM sections_live WHERE tenant_id=$1 ORDER BY id LIMIT 1`,
      [SEED.INSTITUTE_1.id],
    );
    const row = rows[0];
    assert(row);
    const query = row.name.hi || row.name.en;
    const repo = new SectionDrizzleRepository(createDrizzleDb(runtime));
    const records = await withTestContext(() => repo.searchByName(query), {
      tenantId: SEED.INSTITUTE_1.id,
    });
    expect(records.map((record) => record.id)).toContain(row.id);
    expect(records.every((record) => record.tenantId === SEED.INSTITUTE_1.id)).toBe(true);
    const other = await withTestContext(() => repo.searchByName(query), {
      tenantId: SEED.INSTITUTE_2.id,
    });
    expect(other.map((record) => record.id)).not.toContain(row.id);
  });
  it('finds plans within the owning reseller only', async () => {
    const { rows } = await admin.query<NamedRow & { reseller_id: string }>(
      `SELECT id,name,reseller_id FROM plans_live ORDER BY id LIMIT 1`,
    );
    const row = rows[0];
    assert(row);
    const repo = new PlanRepository(createDrizzleDb(runtime));
    const query = row.name.hi || row.name.en;
    const records = await repo.searchByName(row.reseller_id, query);
    expect(records.map((record) => record.id)).toContain(row.id);
    expect(records.every((record) => record.resellerId === row.reseller_id)).toBe(true);
    const other = await repo.searchByName(crypto.randomUUID(), query);
    expect(other).toEqual([]);
  });
});
