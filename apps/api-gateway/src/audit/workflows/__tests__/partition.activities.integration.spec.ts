import { createDrizzleDb } from '@roviq/database';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  TEST_POOLER_URL,
  TEST_SUPERUSER_URL,
} from '../../../../../../libs/database/src/__tests__/test-helpers';
import { createPartitionActivities, type PartitionActivities } from '../partition.activities';
import { getNextMonthStart, getPartitionName } from '../partition.helpers';

let admin: pg.Pool;
let runtime: pg.Pool;
let activities: PartitionActivities;

async function partitionState(
  name: string,
): Promise<{ attached: boolean; sealed: boolean; grantees: number } | undefined> {
  const { rows } = await admin.query<{ attached: boolean; sealed: boolean; grantees: number }>(
    `SELECT c.relispartition AS attached,
            (c.relrowsecurity AND c.relforcerowsecurity) AS sealed,
            (SELECT COUNT(DISTINCT a.grantee)::int FROM aclexplode(c.relacl) a
              WHERE a.grantee <> c.relowner) AS grantees
     FROM pg_class c WHERE c.relname = $1 AND c.relnamespace = 'public'::regnamespace`,
    [name],
  );
  return rows[0];
}

beforeAll(() => {
  admin = new pg.Pool({ connectionString: TEST_SUPERUSER_URL, max: 2 });
  runtime = new pg.Pool({ connectionString: TEST_POOLER_URL, max: 2 });
  activities = createPartitionActivities(createDrizzleDb(runtime));
});

afterAll(async () => {
  await admin.end();
  await runtime.end();
});

describe('audit partition activities', () => {
  it('createNextMonthPartition leaves next month attached and sealed', async () => {
    const expected = getPartitionName(getNextMonthStart(new Date()));

    await expect(activities.createNextMonthPartition()).resolves.toBe(expected);

    expect(await partitionState(expected)).toEqual({ attached: true, sealed: true, grantees: 0 });
    await expect(activities.verifyPartitionHealth(expected)).resolves.toBe(true);
  });

  // Detaching a real audit_logs partition here would lock the FK-referenced
  // tables under parallel suites; the detach itself is covered on a scratch
  // parent in audit-security-invariants.integration.spec.ts.
  it('enforceRetention leaves partitions inside the retention window attached', async () => {
    const current = getPartitionName(new Date());

    await expect(activities.enforceRetention()).resolves.not.toContain(current);

    expect(await partitionState(current)).toEqual({ attached: true, sealed: true, grantees: 0 });
  });
});
