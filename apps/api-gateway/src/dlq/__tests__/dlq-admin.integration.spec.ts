/** The platform DLQ reader through GraphQL: list filters and paging, pending count, discard. */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import {
  createIntegrationApp,
  createPlatformToken,
  gqlRequest,
  type IntegrationAppResult,
} from '@roviq/testing/integration';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../../../../e2e/shared/seed-fixtures';
import { AppModule } from '../../app/app.module';
import { DlqService } from '../dlq.service';

/** Superuser connection: dlq_messages rows are written by the DLQ consumer's own pool. */
const SUPERUSER_URL =
  process.env.DATABASE_URL_TEST_MIGRATE ?? 'postgresql://roviq:roviq_dev@localhost:5435/roviq_test';

const LIST = `query ($filter: DlqMessageFilterInput) {
  adminListDlqMessages(filter: $filter) {
    totalCount
    edges { node { id status originStream } }
    pageInfo { hasNextPage hasPreviousPage endCursor }
  }
}`;
const DISCARD = 'mutation ($id: ID!) { adminDiscardDlqMessage(id: $id) { id status } }';
const REPLAY = 'mutation ($id: ID!) { adminReplayDlqMessage(id: $id) { id status } }';

interface ListResult {
  adminListDlqMessages: {
    totalCount: number;
    edges: { node: { id: string; status: string; originStream: string } }[];
    pageInfo: { hasNextPage: boolean; hasPreviousPage: boolean; endCursor: string | null };
  };
}

describe('DLQ admin reader (integration)', () => {
  let result: IntegrationAppResult;
  let superPool: pg.Pool;
  let token: string;
  const originStream = `ITEST_${randomUUID().slice(0, 8)}`;
  const seqBase = BigInt(Date.now()) * 1000n + 500n;
  const ids: string[] = [];

  const insert = async (offset: bigint) => {
    const res = await superPool.query(
      `INSERT INTO dlq_messages
        (dlq_stream_seq, original_subject, origin_stream, payload, error,
         retry_count, correlation_id, tenant_id, failed_at, status, replay_count)
       VALUES ($1, 'NOTIFICATION.user.created', $2, '{}'::jsonb, 'failure', 3, $3, NULL, NOW(),
               'pending', 0)
       RETURNING id`,
      [(seqBase + offset).toString(), originStream, randomUUID()],
    );
    const id = res.rows[0]?.id;
    assert(typeof id === 'string');
    return id;
  };

  const list = async (filter: Record<string, unknown>) => {
    const res = await gqlRequest<ListResult>(result.httpServer, {
      query: LIST,
      token,
      variables: { filter },
    });
    expect(res.errors).toBeUndefined();
    const data = res.data?.adminListDlqMessages;
    assert(data);
    return data;
  };

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    superPool = new pg.Pool({ connectionString: SUPERUSER_URL, max: 2 });
    token = createPlatformToken({
      sub: SEED_IDS.USER_ADMIN,
      membershipId: randomUUID(),
      roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
    });
    // ids are uuidv7: the second row sorts after the first.
    ids.push(await insert(1n));
    ids.push(await insert(2n));
  });

  afterAll(async () => {
    await superPool?.query('DELETE FROM dlq_messages WHERE origin_stream = $1', [originStream]);
    await superPool?.end();
    await result?.close();
  });

  it('should page the filtered messages newest first', async () => {
    const page1 = await list({ originStream, first: 1 });
    expect(page1.totalCount).toBe(2);
    expect(page1.edges.map((e) => e.node)).toEqual([
      { id: ids[1], status: 'PENDING', originStream },
    ]);
    expect(page1.pageInfo.hasNextPage).toBe(true);
    expect(page1.pageInfo.hasPreviousPage).toBe(false);

    const page2 = await list({ originStream, first: 1, after: page1.pageInfo.endCursor });
    expect(page2.edges.map((e) => e.node.id)).toEqual([ids[0]]);
    expect(page2.pageInfo.hasNextPage).toBe(false);
    expect(page2.pageInfo.hasPreviousPage).toBe(true);
  });

  it('should count pending messages', async () => {
    // Other spec files add and remove dead letters in the same database while this runs, so
    // the count is compared with a direct read taken before and one taken after.
    const direct = async (): Promise<number> => {
      const res = await superPool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM dlq_messages WHERE status = 'pending'",
      );
      return res.rows[0]?.n ?? 0;
    };
    const before = await direct();
    const counted = await result.app.get(DlqService).countPending();
    const after = await direct();

    expect(counted).toBeGreaterThanOrEqual(Math.min(before, after));
    expect(counted).toBeLessThanOrEqual(Math.max(before, after));
    // This spec's own pending rows are always part of it.
    expect(counted).toBeGreaterThanOrEqual(1);
  });

  it('should discard a pending message, then refuse to discard or replay it again', async () => {
    const discarded = await gqlRequest<{ adminDiscardDlqMessage: { id: string; status: string } }>(
      result.httpServer,
      { query: DISCARD, token, variables: { id: ids[0] } },
    );
    expect(discarded.errors).toBeUndefined();
    expect(discarded.data?.adminDiscardDlqMessage).toEqual({ id: ids[0], status: 'DISCARDED' });

    const again = await gqlRequest(result.httpServer, {
      query: DISCARD,
      token,
      variables: { id: ids[0] },
    });
    expect(again.errors?.[0]?.extensions?.code).toBe('INVALID_STATE_TRANSITION');

    const replay = await gqlRequest(result.httpServer, {
      query: REPLAY,
      token,
      variables: { id: ids[0] },
    });
    expect(replay.errors?.[0]?.extensions?.code).toBe('INVALID_STATE_TRANSITION');

    const row = await superPool.query(
      'SELECT status, replay_count FROM dlq_messages WHERE id = $1',
      [ids[0]],
    );
    expect(row.rows[0]).toEqual({ status: 'discarded', replay_count: 0 });

    const filtered = await list({ originStream, status: 'DISCARDED' });
    expect(filtered.edges.map((e) => e.node.id)).toEqual([ids[0]]);
  });

  it('should answer DLQ_MESSAGE_NOT_FOUND for an unknown id', async () => {
    const id = randomUUID();
    for (const query of [DISCARD, REPLAY]) {
      const res = await gqlRequest(result.httpServer, { query, token, variables: { id } });
      expect(res.errors?.[0]?.extensions?.code).toBe('DLQ_MESSAGE_NOT_FOUND');
    }
  });
});
