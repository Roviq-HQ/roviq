/**
 * ROV-19 — DLQ reader E2E against the full running stack.
 *
 * Exercises the platform-admin dead-letter API end-to-end: a real envelope is
 * published to the JetStream `DLQ` stream, the live `dlq-reader` consumer
 * persists it to `dlq_messages`, and the GraphQL surface
 * (`adminListDlqMessages` / `replayDlqMessage` / `discardDlqMessage`) reads and
 * mutates it. Nothing is mocked — NATS, the consumer, Postgres, and the
 * api-gateway are all the live e2e containers.
 *
 * RLS visibility, idempotent insert, and the state-machine guard are covered at
 * the DB level in apps/api-gateway/src/dlq/__tests__/dlq.integration.spec.ts and
 * are not duplicated here.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { jetstream } from '@nats-io/jetstream';
import { headers as natsHeaders } from '@nats-io/nats-core';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loginAsPlatformAdmin } from './helpers/auth';
import { gql } from './helpers/gql-client';

// The e2e NATS publishes on host port 4223 — offset off the dev infra's 4222
// so the two can run side by side. We pin to 4223 (overridable via
// E2E_NATS_URL) and deliberately ignore the ambient `NATS_URL`, which `.env`
// points at the dev-infra NATS (4222): publishing there would land on a
// different JetStream and the e2e api-gateway's dlq-reader would never see it.
const NATS_URL = process.env.E2E_NATS_URL ?? 'nats://localhost:4223';

// Superuser connection used ONLY to delete the platform rows this suite seeds
// (no GraphQL delete exists for dlq_messages). Mirrors the e2e vitest env.
const DB_URL =
  process.env.DATABASE_URL_E2E_MIGRATE ?? 'postgresql://roviq:roviq_dev@localhost:5435/roviq_test';

interface DlqMessageNode {
  id: string;
  originalSubject: string;
  originStream: string;
  payload: { test?: string } | null;
  error: string;
  retryCount: number;
  correlationId: string;
  tenantId: string | null;
  status: string;
  replayCount: number;
  replayedAt: string | null;
}

interface DlqConnection {
  edges: { node: DlqMessageNode }[];
  totalCount: number;
}

const LIST_QUERY = `query ListDlq($filter: DlqMessageFilterInput) {
  adminListDlqMessages(filter: $filter) {
    totalCount
    edges {
      node {
        id originalSubject originStream payload error retryCount
        correlationId tenantId status replayCount replayedAt
      }
    }
  }
}`;

const REPLAY_MUTATION = `mutation Replay($id: ID!) {
  replayDlqMessage(id: $id) { id status replayCount replayedAt }
}`;

const DISCARD_MUTATION = `mutation Discard($id: ID!) {
  discardDlqMessage(id: $id) { id status }
}`;

/** Publish a dead-letter envelope to DLQ.<STREAM>, matching publishToDlq's shape. */
async function publishDeadLetter(
  js: ReturnType<typeof jetstream>,
  marker: string,
  correlationId: string,
): Promise<void> {
  const originalSubject = 'NOTIFICATION.user.created';
  const error = 'e2e seeded failure';
  const envelope = {
    originalSubject,
    payload: { test: marker },
    error,
    retryCount: 5,
    correlationId,
    tenantId: null,
    failedAt: new Date().toISOString(),
  };

  const hdrs = natsHeaders();
  hdrs.set('correlation-id', correlationId);
  hdrs.set('dlq-reason', error);

  await js.publish('DLQ.NOTIFICATION', JSON.stringify(envelope), { headers: hdrs });
}

/**
 * Poll adminListDlqMessages until the row carrying `correlationId` is visible,
 * optionally requiring a specific status. Bounded wait — no fixed sleep.
 */
async function waitForDlqRow(
  token: string,
  correlationId: string,
  opts: { status?: string; timeoutMs?: number } = {},
): Promise<DlqMessageNode> {
  const deadline = Date.now() + (opts.timeoutMs ?? 15_000);
  let last: DlqMessageNode | undefined;
  while (Date.now() < deadline) {
    const res = await gql<{ adminListDlqMessages: DlqConnection }>(
      LIST_QUERY,
      { filter: { originStream: 'NOTIFICATION', first: 100 } },
      token,
    );
    expect(res.errors).toBeUndefined();
    const match = res.data?.adminListDlqMessages.edges.find(
      (e) => e.node.correlationId === correlationId,
    );
    if (match && (!opts.status || match.node.status === opts.status)) {
      return match.node;
    }
    last = match?.node;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `DLQ row for correlationId=${correlationId} not visible within timeout` +
      (last ? ` (last seen status=${last.status})` : ' (never seen)'),
  );
}

describe('DLQ reader E2E (ROV-19)', () => {
  let adminToken: string;
  let nc: NatsConnection;
  let js: ReturnType<typeof jetstream>;
  let cleanupPool: pg.Pool;
  const seededCorrelationIds: string[] = [];

  beforeAll(async () => {
    ({ accessToken: adminToken } = await loginAsPlatformAdmin());
    nc = await connect({ servers: NATS_URL, timeout: 5_000 });
    js = jetstream(nc);
    cleanupPool = new pg.Pool({ connectionString: DB_URL, max: 2 });
  });

  afterAll(async () => {
    for (const cid of seededCorrelationIds) {
      await cleanupPool.query('DELETE FROM dlq_messages WHERE correlation_id = $1', [cid]);
    }
    await cleanupPool.end();
    await nc.drain();
  });

  it('persists a dead-lettered message and surfaces it as pending', async () => {
    const marker = `dlq-pending-${randomUUID()}`;
    const correlationId = randomUUID();
    seededCorrelationIds.push(correlationId);

    await publishDeadLetter(js, marker, correlationId);

    // GraphQL serialises the DlqStatus enum by its SDL name (UPPER_SNAKE).
    const row = await waitForDlqRow(adminToken, correlationId, { status: 'PENDING' });
    expect(row.originalSubject).toBe('NOTIFICATION.user.created');
    expect(row.originStream).toBe('NOTIFICATION');
    expect(row.error).toBe('e2e seeded failure');
    expect(row.retryCount).toBe(5);
    expect(row.payload?.test).toBe(marker);
    expect(row.tenantId).toBeNull();
    expect(row.replayCount).toBe(0);
  });

  it('replayDlqMessage sets status=replayed and replayCount=1', async () => {
    const marker = `dlq-replay-${randomUUID()}`;
    const correlationId = randomUUID();
    seededCorrelationIds.push(correlationId);

    await publishDeadLetter(js, marker, correlationId);
    const pending = await waitForDlqRow(adminToken, correlationId, { status: 'PENDING' });

    const res = await gql<{ replayDlqMessage: DlqMessageNode }>(
      REPLAY_MUTATION,
      { id: pending.id },
      adminToken,
    );
    expect(res.errors).toBeUndefined();
    const replayed = res.data?.replayDlqMessage;
    assert(replayed);
    expect(replayed.id).toBe(pending.id);
    expect(replayed.status).toBe('REPLAYED');
    expect(replayed.replayCount).toBe(1);
    expect(replayed.replayedAt).not.toBeNull();
  });

  it('discardDlqMessage sets status=discarded', async () => {
    const marker = `dlq-discard-${randomUUID()}`;
    const correlationId = randomUUID();
    seededCorrelationIds.push(correlationId);

    await publishDeadLetter(js, marker, correlationId);
    const pending = await waitForDlqRow(adminToken, correlationId, { status: 'PENDING' });

    const res = await gql<{ discardDlqMessage: DlqMessageNode }>(
      DISCARD_MUTATION,
      { id: pending.id },
      adminToken,
    );
    expect(res.errors).toBeUndefined();
    const discarded = res.data?.discardDlqMessage;
    assert(discarded);
    expect(discarded.id).toBe(pending.id);
    expect(discarded.status).toBe('DISCARDED');
  });

  it('rejects an unauthenticated adminListDlqMessages call', async () => {
    const res = await gql(LIST_QUERY, { filter: { originStream: 'NOTIFICATION' } });
    expect(res.errors).toBeDefined();
    expect(res.errors?.length).toBeGreaterThan(0);
  });
});
