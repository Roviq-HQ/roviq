import { randomUUID } from 'node:crypto';
import { jetstream, jetstreamManager, RetentionPolicy, StorageType } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/nats-core';
import { connect } from '@nats-io/transport-node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STREAMS } from '../stream.config';
import { ensureStreams } from '../stream.manager';

const NATS_URL = process.env.NATS_TEST_URL ?? 'nats://localhost:4224';

describe('STREAMS runtime configuration', () => {
  let nc: NatsConnection;
  const prefix = `ROV54_${randomUUID().replaceAll('-', '').toUpperCase()}`;
  const streams = Object.values(STREAMS).map((stream) => ({
    ...stream,
    name: `${prefix}_${stream.name}`,
    subjects: stream.subjects.map((subject) => `${prefix}.${subject}`),
  }));

  beforeAll(async () => {
    nc = await connect({ servers: NATS_URL });
    await ensureStreams(nc, streams);
  });

  afterAll(async () => {
    if (!nc) return;
    const jsm = await jetstreamManager(nc);
    try {
      const existing: string[] = [];
      for await (const name of jsm.streams.names()) existing.push(name);
      for (const stream of streams) {
        if (existing.includes(stream.name)) await jsm.streams.delete(stream.name);
      }
    } finally {
      await nc.drain();
    }
  });

  it('ensures all registered streams twice without duplicates or message loss', async () => {
    const js = jetstream(nc);
    const stream = streams.find((entry) => entry.retention === 'workqueue');
    if (!stream) throw new Error('Expected a workqueue stream');
    const subject = stream.subjects[0]?.replace('>', 'idempotency');
    if (!subject) throw new Error('Expected a configured subject');
    const ack = await js.publish(subject, JSON.stringify({ retained: true }));
    await ensureStreams(nc, streams);
    const jsm = await jetstreamManager(nc);
    const allNames: string[] = [];
    for await (const name of jsm.streams.names()) allNames.push(name);
    expect(allNames.filter((name) => name.startsWith(prefix)).sort()).toEqual(
      streams.map((entry) => entry.name).sort(),
    );
    const stored = await jsm.streams.getMessage(stream.name, { seq: ack.seq });
    expect(stored?.json()).toEqual({ retained: true });
  });

  it.each(
    streams,
  )('creates $name with configured subjects, retention and storage', async (stream) => {
    const jsm = await jetstreamManager(nc);
    const { config } = await jsm.streams.info(stream.name);
    const retention = {
      workqueue: RetentionPolicy.Workqueue,
      interest: RetentionPolicy.Interest,
      limits: RetentionPolicy.Limits,
    };
    expect(config.name).toBe(stream.name);
    expect(config.subjects).toEqual(stream.subjects);
    expect(config.retention).toBe(retention[stream.retention]);
    expect(config.storage).toBe(stream.storage === 'file' ? StorageType.File : StorageType.Memory);
  });

  it.each([
    ['SECTION', 'SECTION.created'],
    ['STUDENT', 'STUDENT.enrolled'],
    ['GROUP', 'GROUP.rules_updated'],
    ['APPLICATION', 'APPLICATION.status_changed'],
    ['ENQUIRY', 'ENQUIRY.created'],
    ['ACADEMIC_YEAR', 'ACADEMIC_YEAR.activated'],
  ])('routes %s events to their configured stream', async (name, subject) => {
    const ack = await jetstream(nc).publish(`${prefix}.${subject}`, JSON.stringify({ test: true }));
    expect(ack.stream).toBe(`${prefix}_${name}`);
    expect(ack.seq).toBeGreaterThan(0);
  });
});
