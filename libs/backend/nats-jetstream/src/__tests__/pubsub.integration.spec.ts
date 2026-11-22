import { randomUUID } from 'node:crypto';
import {
  AckPolicy,
  type Consumer,
  type JetStreamManager,
  jetstream,
  jetstreamManager,
} from '@nats-io/jetstream';
import { headers, type NatsConnection } from '@nats-io/nats-core';
import { connect } from '@nats-io/transport-node';
import { NatsRecordBuilder } from '@nestjs/microservices';
import { type RequestContext, requestContext } from '@roviq/request-context';
import { DrizzleQueryError } from 'drizzle-orm';
import { firstValueFrom } from 'rxjs';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JetStreamClient } from '../client/jetstream.client';
import type { JetStreamContext } from '../context/jetstream.context';
import type { DlqMessage } from '../dlq/dlq.handler';
import type { ConsumerExtras, StreamConfig } from '../interfaces/jetstream.options';
import { JetStreamServer } from '../server/jetstream.server';
import { DEFAULT_DLQ_STREAM } from '../streams/stream.config';
import { ensureStreams } from '../streams/stream.manager';

const servers = [
  process.env.NATS_TEST_URL ?? `nats://localhost:${process.env.DEV_NATS_TEST_PORT ?? '4224'}`,
];
const poll = { timeout: 5_000, interval: 20 };
type Handler = (payload: unknown, context: JetStreamContext) => Promise<void>;

interface Delivery {
  payload: unknown;
  correlationId: string;
  tenantId: string | undefined;
  customHeader: string;
  context: RequestContext | undefined;
}

describe('JetStream transport with a real broker', () => {
  let nc: NatsConnection;
  let jsm: JetStreamManager;
  let publisher: JetStreamClient;
  let stream: StreamConfig;
  let subject: string;
  let durable: string;
  let workers: JetStreamServer[];
  let releases: Array<() => void>;
  let dlqConsumer: string | undefined;
  let createdDlq = false;

  beforeEach(async () => {
    const name = `ROV54_${randomUUID().replaceAll('-', '').toUpperCase()}`;
    stream = {
      name,
      subjects: [`${name}.>`],
      retention: 'workqueue',
      storage: 'file',
      maxDeliver: 3,
    };
    subject = `${name}.event`;
    durable = `${name}_worker`;
    workers = [];
    releases = [];
    dlqConsumer = undefined;
    nc = await connect({ servers });
    jsm = await jetstreamManager(nc);
    publisher = new JetStreamClient({ servers });
    await ensureStreams(nc, [stream]);
  });

  afterEach(async () => {
    for (const release of releases) release();
    await Promise.all(workers.map((worker) => worker.close()));
    await publisher?.close();
    if (dlqConsumer) {
      await jsm.consumers.delete(DEFAULT_DLQ_STREAM.name, dlqConsumer);
      // Limits retention keeps ACKed DLQ entries; remove only this test's subject.
      await jsm.streams.purge(DEFAULT_DLQ_STREAM.name, { filter: `DLQ.${stream.name}` });
    }
    if (jsm) await jsm.streams.delete(stream.name);
    if (nc) await nc.drain();
  });

  afterAll(async () => {
    if (!createdDlq) return;
    const connection = await connect({ servers });
    try {
      const manager = await jetstreamManager(connection);
      const info = await manager.streams.info(DEFAULT_DLQ_STREAM.name);
      if (info.state.consumer_count === 0 && info.state.messages === 0) {
        await manager.streams.delete(DEFAULT_DLQ_STREAM.name);
      }
    } finally {
      await connection.drain();
    }
  });

  async function startWorker(handler: Handler, extras: ConsumerExtras = {}) {
    const worker = new JetStreamServer({
      servers,
      streams: [stream],
      dlq: { enabled: false },
      retry: { baseDelay: 10, maxDelay: 20 },
      pull: { batchSize: 1, expires: 2_000, idleHeartbeat: 1_000 },
    });
    workers.push(worker);
    worker.addHandler(subject, handler, true, { durable, ...extras });
    await new Promise<void>((resolve, reject) => {
      void worker.listen((error) => (error ? reject(error) : resolve()));
    });
    await expect
      .poll(async () => (await jsm.consumers.info(stream.name, durable)).num_waiting, poll)
      .toBeGreaterThan(0);
    return worker;
  }

  async function publish(payload: unknown) {
    const hdrs = headers();
    hdrs.set('correlation-id', 'integration-correlation');
    hdrs.set('tenant-id', 'integration-tenant');
    return firstValueFrom(
      publisher.emit(subject, new NatsRecordBuilder(payload).setHeaders(hdrs).build()),
    );
  }

  async function expectDrained() {
    await expect
      .poll(async () => (await jsm.streams.info(stream.name)).state.messages, poll)
      .toBe(0);
  }

  async function readDlq() {
    const names: string[] = [];
    for await (const name of jsm.streams.names()) names.push(name);
    if (names.includes(DEFAULT_DLQ_STREAM.name)) {
      for await (const consumer of jsm.consumers.list(DEFAULT_DLQ_STREAM.name)) {
        if (!consumer.name.startsWith('ROV54_')) {
          throw new Error(
            'DLQ has application consumers; set NATS_TEST_URL to an isolated test broker',
          );
        }
      }
    }
    if (!names.includes(DEFAULT_DLQ_STREAM.name)) createdDlq = true;
    await ensureStreams(nc, [DEFAULT_DLQ_STREAM]);
    dlqConsumer = `${stream.name}_dlq`;
    await jsm.consumers.add(DEFAULT_DLQ_STREAM.name, {
      durable_name: dlqConsumer,
      filter_subject: `DLQ.${stream.name}`,
      ack_policy: AckPolicy.Explicit,
    });
    return jetstream(nc).consumers.get(DEFAULT_DLQ_STREAM.name, dlqConsumer);
  }

  async function expectTerminated(consumer: Consumer, expected: Omit<DlqMessage, 'failedAt'>) {
    const msg = await consumer.next({ expires: 5_000 });
    expect(msg).not.toBeNull();
    if (!msg) throw new Error('Expected a dead-letter message');
    const deadLetter = msg.json<DlqMessage>();
    expect(deadLetter).toEqual({ ...expected, failedAt: deadLetter.failedAt });
    expect(Number.isNaN(Date.parse(deadLetter.failedAt))).toBe(false);
    expect(msg.headers?.get('correlation-id')).toBe(deadLetter.correlationId);
    expect(msg.headers?.get('tenant-id')).toBe(deadLetter.tenantId);
    expect(await msg.ackAck()).toBe(true);
    await expectDrained();
    const info = await jsm.consumers.info(stream.name, durable);
    expect(info.num_ack_pending).toBe(0);
    expect(info.num_pending).toBe(0);
    expect(await consumer.next({ expires: 1_000 })).toBeNull();
    return deadLetter;
  }

  it('publishes the original payload, propagates request/custom headers, and removes it after ACK', async () => {
    const received: Delivery[] = [];
    await startWorker(async (payload, ctx) => {
      received.push({
        payload,
        correlationId: ctx.getCorrelationId(),
        tenantId: ctx.getTenantId(),
        customHeader: ctx.getHeaders().get('x-review'),
        context: requestContext.getStore(),
      });
    });
    const context: RequestContext = {
      correlationId: randomUUID(),
      tenantId: randomUUID(),
      userId: randomUUID(),
      resellerId: null,
      impersonatorId: null,
      scope: 'institute',
    };
    const hdrs = headers();
    hdrs.set('x-review', 'preserved');
    const payload = { id: randomUUID(), nested: { active: true }, values: [1, 2] };
    await requestContext.run(context, () =>
      firstValueFrom(
        publisher.emit(subject, new NatsRecordBuilder(payload).setHeaders(hdrs).build()),
      ),
    );
    await expectDrained();
    expect(received).toEqual([
      {
        payload,
        correlationId: context.correlationId,
        tenantId: context.tenantId,
        customHeader: 'preserved',
        context,
      },
    ]);
  });

  it('preserves explicit record headers over the ambient request context', async () => {
    const received: string[][] = [];
    await startWorker(async (_payload, ctx) => {
      received.push([ctx.getCorrelationId(), ctx.getTenantId() ?? '']);
    });
    await requestContext.run(
      {
        correlationId: 'ambient-correlation',
        tenantId: 'ambient-tenant',
        userId: '',
        resellerId: null,
        impersonatorId: null,
        scope: 'institute',
      },
      () => publish({ explicit: true }),
    );
    await expectDrained();
    expect(received).toEqual([['integration-correlation', 'integration-tenant']]);
  });

  it('handles absent headers with undefined tenant and a generated correlation context', async () => {
    const contexts: Array<{
      tenant: string | undefined;
      correlation: string;
      context: RequestContext | undefined;
    }> = [];
    await startWorker(async (_payload, ctx) => {
      contexts.push({
        tenant: ctx.getTenantId(),
        correlation: ctx.getCorrelationId(),
        context: requestContext.getStore(),
      });
    });
    await jetstream(nc).publish(subject, JSON.stringify({ missing: true }));
    await expectDrained();
    expect(contexts).toHaveLength(1);
    const delivery = contexts[0];
    expect(delivery?.tenant).toBeUndefined();
    expect(delivery?.correlation).toBe('');
    expect(delivery?.context).toEqual({
      tenantId: null,
      resellerId: null,
      userId: '',
      scope: 'institute',
      impersonatorId: null,
      correlationId: delivery?.context?.correlationId,
    });
    expect(delivery?.context?.correlationId).toMatch(/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i);
  });

  it('NAKs a handler failure and redelivers before acknowledging success', async () => {
    const deliveries: number[] = [];
    await startWorker(async (_payload, ctx) => {
      deliveries.push(ctx.getDeliveryCount());
      if (ctx.getDeliveryCount() === 1) throw new Error('transient handler failure');
    });
    await publish({ retry: true });
    await expectDrained();
    expect(deliveries).toEqual([1, 2]);
  });

  it('routes exhausted retries to DLQ with metadata and terminates the original', async () => {
    const consumer = await readDlq();
    const deliveries: number[] = [];
    const error = 'permanent handler failure';
    await startWorker(async (_payload, ctx) => {
      deliveries.push(ctx.getDeliveryCount());
      throw new Error(error);
    });
    const payload = { id: randomUUID() };
    const terminated: Array<{ stream: string; consumer: string; deliveries: number }> = [];
    const advisory = nc.subscribe(
      `$JS.EVENT.ADVISORY.CONSUMER.MSG_TERMINATED.${stream.name}.${durable}`,
      {
        callback: (_error, msg) => {
          const event = msg.json<{ stream: string; consumer: string; deliveries: number }>();
          terminated.push({
            stream: event.stream,
            consumer: event.consumer,
            deliveries: event.deliveries,
          });
        },
      },
    );
    await nc.flush();
    await publish(payload);
    await expectTerminated(consumer, {
      originalSubject: subject,
      payload,
      error: `Error: ${error}`,
      retryCount: 3,
      correlationId: 'integration-correlation',
      tenantId: 'integration-tenant',
    });
    expect(deliveries).toEqual([1, 2, 3]);
    await expect
      .poll(() => terminated, poll)
      .toEqual([{ stream: stream.name, consumer: durable, deliveries: 3 }]);
    advisory.unsubscribe();
  });

  it('dead-letters the innermost cause of a wrapped error, without the query text', async () => {
    const consumer = await readDlq();
    await startWorker(async () => {
      throw new DrizzleQueryError(
        'insert into "t" ("secret") values ($1)',
        ['secret-param'],
        new Error('duplicate key value violates unique constraint "uq_x"'),
      );
    });
    const payload = { id: randomUUID() };
    await publish(payload);
    await expectTerminated(consumer, {
      originalSubject: subject,
      payload,
      error: 'Error: duplicate key value violates unique constraint "uq_x"',
      retryCount: 3,
      correlationId: 'integration-correlation',
      tenantId: 'integration-tenant',
    });
  });

  it('dead-letters malformed JSON and continues with the next valid message', async () => {
    const consumer = await readDlq();
    const received: unknown[] = [];
    await startWorker(async (payload) => {
      received.push(payload);
    });
    const hdrs = headers();
    hdrs.set('correlation-id', 'malformed-correlation');
    hdrs.set('tenant-id', 'malformed-tenant');
    const bytes = new TextEncoder().encode('{invalid json');
    await jetstream(nc).publish(subject, bytes, { headers: hdrs });
    const msg = await consumer.next({ expires: 5_000 });
    expect(msg).not.toBeNull();
    if (!msg) throw new Error('Expected malformed message in DLQ');
    const dlq = msg.json<DlqMessage>();
    expect(dlq.error).toContain(`Failed to deserialize message on "${subject}"`);
    expect(dlq).toEqual({
      originalSubject: subject,
      payload: { type: 'Buffer', data: [...bytes] },
      error: dlq.error,
      retryCount: 1,
      correlationId: 'malformed-correlation',
      tenantId: 'malformed-tenant',
      failedAt: dlq.failedAt,
    });
    await msg.ackAck();
    await publish({ valid: true });
    await expectDrained();
    expect(received).toEqual([{ valid: true }]);
  });

  it('keeps the durable consumer and pending messages across a worker reconnect', async () => {
    const received: unknown[] = [];
    const handler: Handler = async (payload) => {
      received.push(payload);
    };
    const first = await startWorker(handler);
    await publish({ order: 1 });
    await expectDrained();
    const created = (await jsm.consumers.info(stream.name, durable)).created;
    await first.close();
    workers = [];
    // A pull request the server still holds for the closed worker would take the next message.
    await expect
      .poll(async () => (await jsm.consumers.info(stream.name, durable)).num_waiting, poll)
      .toBe(0);
    await publish({ order: 2 });
    await publish({ order: 3 });
    expect((await jsm.streams.info(stream.name)).state.messages).toBe(2);
    await startWorker(handler);
    await expectDrained();
    expect((await jsm.consumers.info(stream.name, durable)).created).toBe(created);
    expect(received).toEqual([{ order: 1 }, { order: 2 }, { order: 3 }]);
  });

  it('bounds handler concurrency and client pulls while a handler is blocked', async () => {
    const gate = new Promise<void>((resolve) => releases.push(resolve));
    let active = 0;
    let maximum = 0;
    let processed = 0;
    await startWorker(async () => {
      active++;
      maximum = Math.max(maximum, active);
      await gate;
      active--;
      processed++;
    });
    for (let i = 0; i < 20; i++) await publish({ i });
    await expect.poll(() => active, poll).toBe(1);
    const info = await jsm.consumers.info(stream.name, durable);
    // One active handler, one iterator value waiting for the semaphore, and bounded prefetch.
    expect(info.num_ack_pending).toBeLessThanOrEqual(4);
    expect(info.num_pending).toBeGreaterThanOrEqual(16);
    expect(processed).toBe(0);
    for (const release of releases) release();
    await expectDrained();
    expect(processed).toBe(20);
    expect(maximum).toBe(1);
  });

  it('shares one durable between two workers without duplicate processing', async () => {
    const received: number[][] = [[], []];
    for (const bucket of received) {
      await startWorker(async (payload) => {
        if (typeof payload !== 'number') throw new Error('Expected numeric payload');
        bucket.push(payload);
      });
    }
    await expect
      .poll(async () => (await jsm.consumers.info(stream.name, durable)).num_waiting, poll)
      .toBe(2);
    for (let i = 0; i < 30; i++) await publish(i);
    await expectDrained();
    expect(received.every((bucket) => bucket.length > 0)).toBe(true);
    expect(received.flat().sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i));
  });

  it('consumes sequential publishes in order', async () => {
    const received: unknown[] = [];
    await startWorker(async (payload) => {
      received.push(payload);
    });
    for (let i = 0; i < 50; i++) await publish(i);
    await expectDrained();
    expect(received).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it('does not lose messages from concurrent independent publishers', async () => {
    const received: number[] = [];
    await startWorker(async (payload) => {
      if (typeof payload !== 'number') throw new Error('Expected numeric payload');
      received.push(payload);
    });
    const connections = await Promise.all(Array.from({ length: 4 }, () => connect({ servers })));
    try {
      await Promise.all(
        connections.map(async (connection, index) => {
          const js = jetstream(connection);
          for (let i = 0; i < 25; i++) await js.publish(subject, JSON.stringify(index * 25 + i));
        }),
      );
      await expectDrained();
      expect(received.sort((a, b) => a - b)).toEqual(Array.from({ length: 100 }, (_, i) => i));
    } finally {
      await Promise.all(connections.map((connection) => connection.drain()));
    }
  });

  it('rejects an unmatched subject through the publisher observable', async () => {
    await expect(
      firstValueFrom(publisher.emit(`UNMATCHED_${stream.name}.event`, {})),
    ).rejects.toThrow();
    expect((await jsm.streams.info(stream.name)).state.messages).toBe(0);
  });

  it('accepts a large payload within the broker limit and rejects an oversized payload', async () => {
    const sizes: number[] = [];
    await startWorker(async (payload) => {
      if (typeof payload !== 'string') throw new Error('Expected string payload');
      sizes.push(payload.length);
    });
    const limit = nc.info?.max_payload;
    expect(limit).toBeGreaterThan(0);
    if (!limit) throw new Error('Broker did not advertise max_payload');
    const size = Math.min(1024 * 1024 + 1, limit - 1024);
    await publish('x'.repeat(size));
    await expectDrained();
    expect(sizes).toEqual([size]);
    await expect(publish('x'.repeat(Math.max(limit + 1, 1024 * 1024 + 1)))).rejects.toThrow(
      "'payload' max_payload size exceeded",
    );
    expect((await jsm.streams.info(stream.name)).state.messages).toBe(0);
  });
});
