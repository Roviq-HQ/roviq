import { metrics } from '@opentelemetry/api';
import { MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
import { createMock } from '@roviq/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelAdapter } from '../../delivery/adapters/channel-adapter';
import { ChannelAdapters } from '../../delivery/adapters/channel-adapters';
import type { ProviderBreaker } from '../../delivery/rate/provider-breaker';
import type { DeliveryStatsRepository } from '../../repositories/delivery-stats.repository';
import type { MessagingSenderRepository } from '../../repositories/messaging-sender.repository';
import type { MessagingTemplateRepository } from '../../repositories/messaging-template.repository';
import type { SenderStateRecord } from '../../repositories/types';
import {
  breakerTargets,
  NotificationStateGauges,
  skippedReadings,
  stateReadings,
} from '../notification-state-gauges';

class TestReader extends MetricReader {
  protected async onShutdown(): Promise<void> {}
  protected async onForceFlush(): Promise<void> {}
}

const adapter = (channel: ChannelAdapter['channel'], provider: string) =>
  createMock<ChannelAdapter>({ channel, provider });

const sender = (
  id: string,
  status: SenderStateRecord['status'],
  channel: SenderStateRecord['channel'] = 'WHATSAPP',
): SenderStateRecord => ({ id, channel, provider: 'whatsapp_cloud', status });

describe('stateReadings', () => {
  const adapters = [adapter('EMAIL', 'smtp'), adapter('WHATSAPP', 'whatsapp_cloud')];
  const senders = [sender('s1', 'ACTIVE'), sender('s2', 'BLOCKED'), sender('s3', 'PAUSED')];

  it('should name the breaker of every provider and every live sender', () => {
    expect(breakerTargets(adapters, senders).map((t) => t.name)).toEqual([
      'adapter:EMAIL:smtp',
      'adapter:WHATSAPP:whatsapp_cloud',
      'sender:s1',
      'sender:s2',
      'sender:s3',
    ]);
  });

  it('should count open breakers per channel and provider, and 0 where none is open', () => {
    const targets = breakerTargets(adapters, senders);

    const readings = stateReadings(targets, new Set(['sender:s1', 'sender:s2']), senders);

    expect(readings.breakersOpen).toEqual([
      { channel: 'EMAIL', provider: 'smtp', open: 0 },
      { channel: 'WHATSAPP', provider: 'whatsapp_cloud', open: 2 },
    ]);
  });

  it('should count BLOCKED senders on every channel, PAUSED ones not', () => {
    const readings = stateReadings([], new Set(), senders);

    expect(readings.sendersBlocked).toEqual([
      { channel: 'EMAIL', blocked: 0 },
      { channel: 'PUSH', blocked: 0 },
      { channel: 'SMS', blocked: 0 },
      { channel: 'WHATSAPP', blocked: 1 },
    ]);
  });
});

describe('skippedReadings', () => {
  it('should report a label set seen before as 0 once its skips leave the window', () => {
    const seen = new Set<string>();

    expect(skippedReadings([{ channel: 'SMS', reason: 'no_template', count: 1 }], seen)).toEqual([
      { channel: 'SMS', reason: 'no_template', count: 1 },
    ]);
    expect(skippedReadings([{ channel: 'EMAIL', reason: 'no_provider', count: 2 }], seen)).toEqual([
      { channel: 'EMAIL', reason: 'no_provider', count: 2 },
      { channel: 'SMS', reason: 'no_template', count: 0 },
    ]);
  });

  it('should keep the reason label bounded', () => {
    expect(
      skippedReadings([{ channel: 'SMS', reason: 'something new', count: 1 }], new Set()),
    ).toEqual([{ channel: 'SMS', reason: 'other', count: 1 }]);
  });
});

describe('NotificationStateGauges', () => {
  let reader: TestReader;
  const breaker = createMock<ProviderBreaker>();
  const senders = createMock<MessagingSenderRepository>();
  const stats = createMock<DeliveryStatsRepository>();
  const templates = createMock<MessagingTemplateRepository>();

  beforeEach(() => {
    reader = new TestReader();
    metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));
    senders.listStates.mockResolvedValue([sender('s2', 'BLOCKED')]);
    breaker.openAmong.mockResolvedValue(new Set(['adapter:SMS:http']));
    templates.countProblems.mockResolvedValue([
      { problem: 'REJECTED', count: 1 },
      { problem: 'CATEGORY_CHANGED', count: 0 },
    ]);
    stats.countSkippedSince.mockResolvedValue([
      { channel: 'WHATSAPP', reason: 'no_template', count: 1 },
    ]);
  });

  afterEach(() => {
    metrics.disable();
    vi.clearAllMocks();
  });

  async function collect(): Promise<Map<string, Array<{ labels: object; value: number }>>> {
    const { resourceMetrics, errors } = await reader.collect();
    expect(errors).toEqual([]);
    const out = new Map<string, Array<{ labels: object; value: number }>>();
    for (const scope of resourceMetrics.scopeMetrics) {
      for (const metric of scope.metrics) {
        out.set(
          metric.descriptor.name,
          metric.dataPoints.map((p) => ({ labels: p.attributes, value: Number(p.value) })),
        );
      }
    }
    return out;
  }

  function start(): NotificationStateGauges {
    const gauges = new NotificationStateGauges(
      new ChannelAdapters([adapter('SMS', 'http'), adapter('EMAIL', 'smtp')]),
      breaker,
      senders,
      stats,
      templates,
    );
    gauges.onModuleInit();
    return gauges;
  }

  it('should report the states with only channel and provider labels, no sender or institute', async () => {
    start();

    const got = await collect();

    expect(got.get('notification.breaker.open')).toEqual(
      expect.arrayContaining([
        { labels: { channel: 'SMS', provider: 'http' }, value: 1 },
        { labels: { channel: 'EMAIL', provider: 'smtp' }, value: 0 },
        { labels: { channel: 'WHATSAPP', provider: 'whatsapp_cloud' }, value: 0 },
      ]),
    );
    expect(got.get('notification.breaker.open')).toHaveLength(3);
    expect(got.get('notification.sender.blocked')).toContainEqual({
      labels: { channel: 'WHATSAPP' },
      value: 1,
    });
    expect(got.get('notification.skipped.recent')).toEqual([
      { labels: { channel: 'WHATSAPP', reason: 'no_template' }, value: 1 },
    ]);
    expect(breaker.openAmong).toHaveBeenCalledWith([
      'adapter:SMS:http',
      'adapter:EMAIL:smtp',
      'sender:s2',
    ]);
    const since = stats.countSkippedSince.mock.calls[0]?.[0];
    expect(Date.now() - (since?.getTime() ?? 0)).toBeGreaterThanOrEqual(15 * 60_000);
  });

  it('should report neither state when Redis cannot be read, rather than a 0 that clears an alert', async () => {
    breaker.openAmong.mockRejectedValue(new Error('redis down'));
    start();

    const got = await collect();

    expect(got.get('notification.breaker.open') ?? []).toEqual([]);
    expect(got.get('notification.sender.blocked') ?? []).toEqual([]);
    expect(got.get('notification.skipped.recent')).toHaveLength(1);
  });

  it('should stop reading once the module is destroyed', async () => {
    start().onModuleDestroy();

    await collect();

    expect(senders.listStates).not.toHaveBeenCalled();
    expect(stats.countSkippedSince).not.toHaveBeenCalled();
  });
});
