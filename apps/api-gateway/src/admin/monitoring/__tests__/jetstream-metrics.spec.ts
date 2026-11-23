import type { NatsConnection } from '@nats-io/nats-core';
import {
  type BatchObservableCallback,
  type BatchObservableResult,
  type Meter,
  metrics,
  type ObservableGauge,
} from '@opentelemetry/api';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JetStreamMetrics } from '../jetstream-metrics';

interface FakeConsumer {
  name: string;
  num_pending: number;
  num_redelivered: number;
  num_ack_pending: number;
}

interface FakeStream {
  name: string;
  messages: number;
  bytes: number;
  consumers: FakeConsumer[];
}

const nats = vi.hoisted(() => ({
  streams: [] as FakeStream[],
  failure: null as Error | null,
}));

vi.mock('@nats-io/jetstream', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nats-io/jetstream')>()),
  jetstreamManager: vi.fn(async () => {
    if (nats.failure) throw nats.failure;
    return {
      streams: {
        list: () =>
          (async function* () {
            for (const s of nats.streams) {
              yield {
                config: { name: s.name },
                state: { messages: s.messages, bytes: s.bytes, consumer_count: s.consumers.length },
              };
            }
          })(),
      },
      consumers: {
        list: (stream: string) =>
          (async function* () {
            yield* nats.streams.find((s) => s.name === stream)?.consumers ?? [];
          })(),
      },
    };
  }),
}));

describe('JetStreamMetrics', () => {
  let callback: BatchObservableCallback | null;
  let observed: Array<[string, number, Record<string, unknown>]>;
  let meter: Meter;
  let provider: JetStreamMetrics;
  const result = createMock<BatchObservableResult>({
    observe: vi.fn((gauge: ObservableGauge, value: number, attrs: Record<string, unknown>) => {
      observed.push([gaugeNames.get(gauge) ?? 'unknown', value, attrs]);
    }),
  });
  const gaugeNames = new Map<ObservableGauge, string>();

  beforeEach(() => {
    callback = null;
    observed = [];
    gaugeNames.clear();
    nats.failure = null;
    nats.streams = [
      {
        name: 'AUDIT',
        messages: 10,
        bytes: 2_048,
        consumers: [{ name: 'audit-log', num_pending: 3, num_redelivered: 1, num_ack_pending: 2 }],
      },
      { name: 'NOTIFICATION', messages: 0, bytes: 0, consumers: [] },
    ];
    meter = createMock<Meter>({
      createObservableGauge: vi.fn((name: string) => {
        const gauge = createMock<ObservableGauge>();
        gaugeNames.set(gauge, name);
        return gauge;
      }),
      addBatchObservableCallback: vi.fn((cb: BatchObservableCallback) => {
        callback = cb;
      }),
      removeBatchObservableCallback: vi.fn(),
    });
    vi.spyOn(metrics, 'getMeter').mockReturnValue(meter);
    provider = new JetStreamMetrics(createMock<NatsConnection>());
    provider.onModuleInit();
  });

  async function collect(): Promise<void> {
    if (!callback) throw new Error('no batch callback registered');
    await callback(result);
  }

  it('should observe stream and consumer gauges for every stream', async () => {
    await collect();

    expect(observed).toEqual([
      ['jetstream_stream_total_messages', 10, { stream_name: 'AUDIT' }],
      ['jetstream_stream_total_bytes', 2_048, { stream_name: 'AUDIT' }],
      ['jetstream_stream_consumer_count', 1, { stream_name: 'AUDIT' }],
      ['jetstream_consumer_num_pending', 3, { stream_name: 'AUDIT', consumer_name: 'audit-log' }],
      [
        'jetstream_consumer_num_redelivered',
        1,
        { stream_name: 'AUDIT', consumer_name: 'audit-log' },
      ],
      [
        'jetstream_consumer_num_ack_pending',
        2,
        { stream_name: 'AUDIT', consumer_name: 'audit-log' },
      ],
      ['jetstream_stream_total_messages', 0, { stream_name: 'NOTIFICATION' }],
      ['jetstream_stream_total_bytes', 0, { stream_name: 'NOTIFICATION' }],
      ['jetstream_stream_consumer_count', 0, { stream_name: 'NOTIFICATION' }],
    ]);
  });

  it('should observe nothing and not throw when NATS fails', async () => {
    nats.failure = new Error('no responders');

    await expect(collect()).resolves.toBeUndefined();

    expect(observed).toEqual([]);
  });

  it('should retry a fresh JetStream manager on the next export after a failure', async () => {
    nats.failure = new Error('no responders');
    await collect();
    nats.failure = null;

    await collect();

    expect(observed).toHaveLength(9);
  });

  it('should remove its batch callback on module destroy', () => {
    provider.onModuleDestroy();

    expect(meter.removeBatchObservableCallback).toHaveBeenCalledWith(callback, [
      ...gaugeNames.keys(),
    ]);
  });
});
