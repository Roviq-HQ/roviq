/**
 * ROV-19 — DLQ message integration tests against the live test DB.
 *
 * Exercises three database-level invariants for `dlq_messages` (the
 * cross-tenant, platform-admin-only dead-letter table):
 *   1. RLS visibility — only `roviq_admin` sees rows; `roviq_app` and
 *      `roviq_reseller` are denied (0 rows, no policy on a FORCE-RLS table).
 *   2. Idempotent insert — `ON CONFLICT (dlq_stream_seq) DO NOTHING` keeps a
 *      duplicate dedup key to a single row (NATS redelivery safety).
 *   3. State transitions — the DB UPDATE `DlqService.replay` performs
 *      (status→replayed, replayCount=1, replayedBy set) and the
 *      `DLQ_STATE_MACHINE` guard the service applies before publishing.
 *
 * Replay's NATS publish is NOT exercised here: the success path is verified at
 * the DB-write level (the mutation the service runs inside `withAdmin`), and
 * the rejected `discarded → replayed` path is verified via the same state
 * machine the service calls — which throws before any publish. No real NATS.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { BusinessException, DLQ_STATE_MACHINE } from '@roviq/common-types';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const hasTestDb = !!process.env.DATABASE_URL_TEST;

/** roviq_pooler connection — NOINHERIT, assumes a role via SET LOCAL ROLE. */
const POOLER_URL =
  process.env.DATABASE_URL_TEST ??
  'postgresql://roviq_pooler:roviq_pooler_dev@localhost:5435/roviq_test';

/** Superuser connection — seeds/cleans test rows, bypasses RLS. */
const SUPERUSER_URL =
  process.env.DATABASE_URL_TEST_MIGRATE ?? 'postgresql://roviq:roviq_dev@localhost:5435/roviq_test';

// Seed institute id (matches e2e/shared/seed-fixtures.ts) — used only as a
// realistic tenant context for the roviq_app denial check; never written to.
const SEED_INSTITUTE_1 = '00000000-0000-7000-a000-000000000101';
const SEED_RESELLER_DIRECT = '00000000-0000-7000-a000-000000000011';

let poolerPool: pg.Pool;
let superPool: pg.Pool;

// dlq_stream_seq values created by this suite — cleaned up in afterEach.
const createdSeqs: bigint[] = [];
// Test users created for the replayedBy FK — cleaned up in afterEach.
const createdUserIds: string[] = [];

/** Run a callback as a role inside a rolled-back transaction (no data leaks). */
async function asRole(
  role: string,
  vars: Record<string, string>,
  fn: (client: pg.PoolClient) => Promise<void>,
): Promise<void> {
  const client = await poolerPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    for (const [key, value] of Object.entries(vars)) {
      await client.query('SELECT set_config($1, $2, true)', [key, value]);
    }
    await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

/** Insert a dlq_messages row via superuser (bypasses RLS). Returns its id. */
async function insertDlqRow(
  seq: bigint,
  overrides: Partial<{
    status: string;
    originalSubject: string;
    originStream: string;
    correlationId: string;
    tenantId: string | null;
    replayCount: number;
  }> = {},
): Promise<string> {
  createdSeqs.push(seq);
  const res = await superPool.query(
    `INSERT INTO dlq_messages
      (dlq_stream_seq, original_subject, origin_stream, payload, error,
       retry_count, correlation_id, tenant_id, failed_at, status, replay_count)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, NOW(), $9, $10)
     ON CONFLICT (dlq_stream_seq) DO NOTHING
     RETURNING id`,
    [
      seq.toString(),
      overrides.originalSubject ?? 'NOTIFICATION.user.created',
      overrides.originStream ?? 'NOTIFICATION',
      JSON.stringify({ userId: 'u-1' }),
      'simulated downstream failure',
      3,
      overrides.correlationId ?? randomUUID(),
      overrides.tenantId ?? null,
      overrides.status ?? 'pending',
      overrides.replayCount ?? 0,
    ],
  );
  const id = res.rows[0]?.id;
  assert(typeof id === 'string', 'expected inserted dlq_messages id');
  return id;
}

/** Create a real user for the replayedBy FK. Returns the user id. */
async function createReplayUser(): Promise<string> {
  const id = randomUUID();
  createdUserIds.push(id);
  await superPool.query(
    `INSERT INTO users (id, username, email, password_hash)
     VALUES ($1, $2, $3, 'not-a-real-hash')`,
    [id, `dlq-replayer-${id.slice(-8)}`, `dlq-${id.slice(-8)}@test.local`],
  );
  return id;
}

beforeAll(async () => {
  if (!hasTestDb) return;
  poolerPool = new pg.Pool({ connectionString: POOLER_URL, max: 5 });
  superPool = new pg.Pool({ connectionString: SUPERUSER_URL, max: 2 });

  const res = await poolerPool.query('SELECT 1 as ok');
  expect(res.rows[0].ok).toBe(1);
});

afterEach(async () => {
  if (!hasTestDb) return;
  for (const seq of createdSeqs.splice(0)) {
    await superPool.query(`DELETE FROM dlq_messages WHERE dlq_stream_seq = $1`, [seq.toString()]);
  }
  for (const userId of createdUserIds.splice(0)) {
    await superPool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  }
});

afterAll(async () => {
  if (!hasTestDb) return;
  await poolerPool.end();
  await superPool.end();
});

const describeDb = hasTestDb ? describe : describe.skip;

describeDb('DLQ messages (integration)', () => {
  // ── 1. RLS visibility ────────────────────────────────────────────────────
  describe('RLS visibility', () => {
    it('roviq_admin can SELECT a dlq_messages row', async () => {
      const seq = BigInt(Date.now()) * 1000n + 1n;
      await insertDlqRow(seq);

      await asRole('roviq_admin', {}, async (client) => {
        const res = await client.query(
          `SELECT id, status FROM dlq_messages WHERE dlq_stream_seq = $1`,
          [seq.toString()],
        );
        expect(res.rows).toHaveLength(1);
        expect(res.rows[0].status).toBe('pending');
      });
    });

    it('roviq_app CANNOT see a dlq_messages row (RLS denies, platform-only)', async () => {
      const seq = BigInt(Date.now()) * 1000n + 2n;
      await insertDlqRow(seq);

      await asRole('roviq_app', { 'app.current_tenant_id': SEED_INSTITUTE_1 }, async (client) => {
        const res = await client.query(`SELECT id FROM dlq_messages WHERE dlq_stream_seq = $1`, [
          seq.toString(),
        ]);
        expect(res.rows).toHaveLength(0);
      });
    });

    it('roviq_reseller CANNOT see a dlq_messages row (RLS denies, platform-only)', async () => {
      const seq = BigInt(Date.now()) * 1000n + 3n;
      await insertDlqRow(seq);

      await asRole(
        'roviq_reseller',
        { 'app.current_reseller_id': SEED_RESELLER_DIRECT },
        async (client) => {
          const res = await client.query(`SELECT id FROM dlq_messages WHERE dlq_stream_seq = $1`, [
            seq.toString(),
          ]);
          expect(res.rows).toHaveLength(0);
        },
      );
    });
  });

  // ── 2. Idempotent insert ─────────────────────────────────────────────────
  describe('idempotent insert (ON CONFLICT dlq_stream_seq DO NOTHING)', () => {
    it('two inserts with the same dlq_stream_seq yield exactly one row', async () => {
      const seq = BigInt(Date.now()) * 1000n + 4n;
      const correlationId = randomUUID();

      const firstId = await insertDlqRow(seq, { correlationId });
      // Second insert with the same dedup key, different payload metadata —
      // simulates NATS redelivery; must be a no-op.
      const dupRes = await superPool.query(
        `INSERT INTO dlq_messages
          (dlq_stream_seq, original_subject, origin_stream, payload, error,
           retry_count, correlation_id, failed_at, status, replay_count)
         VALUES ($1, 'NOTIFICATION.user.created', 'NOTIFICATION', '{}'::jsonb,
                 'redelivered', 4, $2, NOW(), 'pending', 0)
         ON CONFLICT (dlq_stream_seq) DO NOTHING
         RETURNING id`,
        [seq.toString(), randomUUID()],
      );

      expect(dupRes.rows).toHaveLength(0); // conflict → nothing returned

      const countRes = await superPool.query(
        `SELECT COUNT(*)::int AS cnt FROM dlq_messages WHERE dlq_stream_seq = $1`,
        [seq.toString()],
      );
      expect(countRes.rows[0].cnt).toBe(1);

      // Surviving row is the original — retry_count untouched by the redelivery.
      const rowRes = await superPool.query(
        `SELECT id, retry_count FROM dlq_messages WHERE dlq_stream_seq = $1`,
        [seq.toString()],
      );
      expect(rowRes.rows[0].id).toBe(firstId);
      expect(rowRes.rows[0].retry_count).toBe(3);
    });
  });

  // ── 3. State transitions ─────────────────────────────────────────────────
  describe('state transitions (replay)', () => {
    it('pending row → replay sets status=replayed, replayCount=1, replayedBy', async () => {
      const seq = BigInt(Date.now()) * 1000n + 5n;
      const id = await insertDlqRow(seq, { status: 'pending', replayCount: 0 });
      const replayerId = await createReplayUser();

      // The DLQ_STATE_MACHINE guard the service runs before publishing.
      expect(() => DLQ_STATE_MACHINE.assertTransition('pending', 'replayed')).not.toThrow();

      // The DB mutation DlqService.replay performs inside withAdmin, run as the
      // policy-matched roviq_admin role (FORCE RLS requires it).
      await asRole('roviq_admin', {}, async (client) => {
        const res = await client.query(
          `UPDATE dlq_messages
             SET status = 'replayed', replayed_at = NOW(), replayed_by = $2,
                 replay_count = replay_count + 1
           WHERE id = $1
           RETURNING status, replay_count, replayed_by, replayed_at`,
          [id, replayerId],
        );
        expect(res.rows).toHaveLength(1);
        const row = res.rows[0];
        expect(row.status).toBe('replayed');
        expect(row.replay_count).toBe(1);
        expect(row.replayed_by).toBe(replayerId);
        expect(row.replayed_at).not.toBeNull();
      });
    });

    it('discarded row → replay is rejected by DLQ_STATE_MACHINE (no DB write, no publish)', async () => {
      const seq = BigInt(Date.now()) * 1000n + 6n;
      await insertDlqRow(seq, { status: 'discarded' });

      // The service calls DLQ_STATE_MACHINE.assertTransition(status, 'replayed')
      // BEFORE any NATS publish — for a discarded row this throws, so replay is
      // a no-op against both NATS and the DB.
      expect(() => DLQ_STATE_MACHINE.assertTransition('discarded', 'replayed')).toThrow(
        BusinessException,
      );

      // The row must remain discarded — guard runs before the UPDATE.
      const res = await superPool.query(
        `SELECT status, replay_count FROM dlq_messages WHERE dlq_stream_seq = $1`,
        [seq.toString()],
      );
      expect(res.rows[0].status).toBe('discarded');
      expect(res.rows[0].replay_count).toBe(0);
    });
  });
});
