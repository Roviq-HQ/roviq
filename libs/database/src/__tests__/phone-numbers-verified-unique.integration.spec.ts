/**
 * ROV-292: a typed mobile number is contact data and may repeat across users; only a verified
 * number has one owner (`phone_numbers_country_code_number_key`).
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_SUPERUSER_URL } from './test-helpers';

const SEED = {
  USER_ADMIN: '00000000-0000-7000-a000-000000000201',
  USER_TEACHER: '00000000-0000-7000-a000-000000000202',
  SYSTEM: '00000000-0000-0000-0000-000000000000',
};

let superPool: pg.Pool;

beforeAll(async () => {
  superPool = new pg.Pool({ connectionString: TEST_SUPERUSER_URL, max: 2 });
});

afterAll(async () => {
  await superPool.end();
});

async function inTransaction(fn: (client: pg.PoolClient) => Promise<void>): Promise<void> {
  const client = await superPool.connect();
  try {
    await client.query('BEGIN');
    await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

/** Not a primary number, so the one-primary-per-user index stays out of the way. */
function insertPhone(client: pg.PoolClient, userId: string, number: string, verified: boolean) {
  return client.query(
    `INSERT INTO phone_numbers (user_id, country_code, number, is_primary, is_verified, created_by, updated_by)
     VALUES ($1, '+91', $2, false, $3, $4, $4)`,
    [userId, number, verified, SEED.SYSTEM],
  );
}

function uniqueNumber(): string {
  return `9${String(Date.now()).slice(-9)}`;
}

describe('ROV-292: phone_numbers uniqueness', () => {
  it('accepts the same unverified number on two users', async () => {
    await inTransaction(async (client) => {
      const number = uniqueNumber();
      await insertPhone(client, SEED.USER_ADMIN, number, false);
      await insertPhone(client, SEED.USER_TEACHER, number, false);

      const rows = await client.query<{ user_id: string }>(
        `SELECT user_id FROM phone_numbers WHERE country_code = '+91' AND number = $1 ORDER BY user_id`,
        [number],
      );
      expect(rows.rows.map((r) => r.user_id)).toEqual([SEED.USER_ADMIN, SEED.USER_TEACHER]);
    });
  });

  it('accepts a verified number beside unverified copies of it', async () => {
    await inTransaction(async (client) => {
      const number = uniqueNumber();
      await insertPhone(client, SEED.USER_ADMIN, number, false);

      await expect(insertPhone(client, SEED.USER_TEACHER, number, true)).resolves.toMatchObject({
        rowCount: 1,
      });
    });
  });

  it('refuses a second verified row with the same number', async () => {
    await inTransaction(async (client) => {
      const number = uniqueNumber();
      await insertPhone(client, SEED.USER_ADMIN, number, true);

      await expect(insertPhone(client, SEED.USER_TEACHER, number, true)).rejects.toMatchObject({
        code: '23505',
        constraint: 'phone_numbers_country_code_number_key',
      });
    });
  });

  it('refuses verifying a number another user already verified', async () => {
    await inTransaction(async (client) => {
      const number = uniqueNumber();
      await insertPhone(client, SEED.USER_ADMIN, number, true);
      await insertPhone(client, SEED.USER_TEACHER, number, false);

      await expect(
        client.query(
          `UPDATE phone_numbers SET is_verified = true WHERE user_id = $1 AND number = $2`,
          [SEED.USER_TEACHER, number],
        ),
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'phone_numbers_country_code_number_key',
      });
    });
  });
});
