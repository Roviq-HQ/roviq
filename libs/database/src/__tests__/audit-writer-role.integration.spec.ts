/**
 * SF-082: the audit and dead-letter consumers log in as roviq_audit_writer. The role may INSERT
 * into audit_logs and dlq_messages and do nothing else: no reads, no changes, no other table.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_SUPERUSER_URL } from './test-helpers';

const USER_ADMIN = '00000000-0000-7000-a000-000000000201';

let superPool: pg.Pool;

/** Runs `fn` as roviq_audit_writer in a transaction that is always rolled back. */
async function asWriter(fn: (client: pg.PoolClient) => Promise<void>): Promise<void> {
  const client = await superPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE roviq_audit_writer');
    await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

/** Each refusal is its own transaction: a failed statement aborts the one it ran in. */
async function refused(sql: string, params: unknown[] = []): Promise<void> {
  await asWriter(async (client) => {
    await expect(client.query(sql, params)).rejects.toThrow(
      /permission denied|row-level security|must be owner/,
    );
  });
}

beforeAll(() => {
  superPool = new pg.Pool({ connectionString: TEST_SUPERUSER_URL, max: 2 });
});

afterAll(async () => {
  await superPool.end();
});

describe('roviq_audit_writer (SF-082)', () => {
  it('is a plain login role with no inherited or bypass rights', async () => {
    const { rows } = await superPool.query(
      `SELECT rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb,
              (SELECT count(*) FROM pg_auth_members m WHERE m.member = r.oid)::int AS memberships
         FROM pg_roles r WHERE rolname = 'roviq_audit_writer'`,
    );
    expect(rows).toEqual([
      {
        rolcanlogin: true,
        rolinherit: false,
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
        memberships: 0,
      },
    ]);
  });

  it('inserts an audit entry for any scope, as the consumer does', async () => {
    await asWriter(async (client) => {
      const res = await client.query(
        `INSERT INTO audit_logs
           (scope, user_id, actor_id, action, action_type, entity_type, correlation_id, source)
         VALUES ('platform', $1, $1, 'audit_writer_check', 'CREATE', 'Test', $2, 'TEST')
         ON CONFLICT (id, created_at) DO NOTHING`,
        [USER_ADMIN, randomUUID()],
      );
      expect(res.rowCount).toBe(1);
    });
  });

  it('inserts a dead-lettered message, as the consumer does', async () => {
    await asWriter(async (client) => {
      const res = await client.query(
        `INSERT INTO dlq_messages
           (dlq_stream_seq, original_subject, origin_stream, payload, error, retry_count,
            correlation_id, failed_at)
         VALUES ($1, 'TEST.subject', 'TEST', '{}'::jsonb, 'boom', 3, $2, now())
         ON CONFLICT (dlq_stream_seq) DO NOTHING`,
        [String(Date.now()), randomUUID()],
      );
      expect(res.rowCount).toBe(1);
    });
  });

  it('cannot read, change or delete audit entries', async () => {
    await refused('SELECT action FROM audit_logs LIMIT 1');
    await refused(`UPDATE audit_logs SET action = 'x'`);
    await refused('DELETE FROM audit_logs');
  });

  it('cannot read, change or delete dead-lettered messages', async () => {
    await refused('SELECT payload FROM dlq_messages LIMIT 1');
    await refused(`UPDATE dlq_messages SET error = 'x'`);
    await refused('DELETE FROM dlq_messages');
  });

  it('cannot touch any other table', async () => {
    await refused('SELECT id FROM users LIMIT 1');
    await refused('SELECT id FROM institutes LIMIT 1');
    await refused(`UPDATE users SET password_hash = 'x'`);
  });

  it('cannot change the schema', async () => {
    await refused('CREATE TABLE audit_writer_probe (id int)');
    await refused('ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY');
  });
});
