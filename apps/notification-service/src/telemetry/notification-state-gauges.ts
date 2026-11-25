import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  type BatchObservableCallback,
  metrics,
  type ObservableGauge,
  type ObservableResult,
} from '@opentelemetry/api';
import {
  MessagingSenderStatus,
  NOTIFICATION_CHANNEL_VALUES,
  type NotificationChannel,
} from '@roviq/common-types';
import { senderBreakerName } from '@roviq/redis';
import { ChannelAdapters } from '../delivery/adapters/channel-adapters';
import { adapterBreakerName, ProviderBreaker } from '../delivery/rate/provider-breaker';
import {
  DeliveryStatsRepository,
  type SkippedCount,
} from '../repositories/delivery-stats.repository';
import { MessagingSenderRepository } from '../repositories/messaging-sender.repository';
import { MessagingTemplateRepository } from '../repositories/messaging-template.repository';
import type { SenderStateRecord } from '../repositories/types';
import {
  NOTIFICATION_METRIC_LABELS as L,
  NOTIFICATION_INSTRUMENTS,
  reasonLabel,
} from './notification-metrics';

/** The span `notification.skipped.recent` counts over. */
export const SKIPPED_RECENT_WINDOW_MS = 15 * 60_000;

/** One breaker and the labels it is counted under. */
export interface BreakerTarget {
  name: string;
  channel: NotificationChannel;
  provider: string;
}

export interface StateReadings {
  /** Every channel and provider that has a breaker, with how many are open now (often 0). */
  breakersOpen: Array<{ channel: NotificationChannel; provider: string; open: number }>;
  /** Every channel, with how many live senders are BLOCKED. */
  sendersBlocked: Array<{ channel: NotificationChannel; blocked: number }>;
}

/** The breaker of every provider and of every live sender. */
export function breakerTargets(
  adapters: ReadonlyArray<{ channel: NotificationChannel; provider: string }>,
  senders: readonly SenderStateRecord[],
): BreakerTarget[] {
  return [
    ...adapters.map((a) => ({
      name: adapterBreakerName(a.channel, a.provider),
      channel: a.channel,
      provider: a.provider,
    })),
    ...senders.map((s) => ({
      name: senderBreakerName(s.id),
      channel: s.channel,
      provider: s.provider,
    })),
  ];
}

/**
 * Counts per label set. A label set with nothing open still reads 0, so an alert on the gauge
 * clears on the next reading instead of waiting for the old sample to go stale.
 */
export function stateReadings(
  targets: readonly BreakerTarget[],
  open: ReadonlySet<string>,
  senders: readonly SenderStateRecord[],
): StateReadings {
  const breakers = new Map<string, StateReadings['breakersOpen'][number]>();
  for (const t of targets) {
    const key = `${t.channel}\u0000${t.provider}`;
    const entry = breakers.get(key) ?? { channel: t.channel, provider: t.provider, open: 0 };
    if (open.has(t.name)) entry.open += 1;
    breakers.set(key, entry);
  }
  return {
    breakersOpen: [...breakers.values()],
    sendersBlocked: NOTIFICATION_CHANNEL_VALUES.map((channel) => ({
      channel,
      blocked: senders.filter(
        (s) => s.channel === channel && s.status === MessagingSenderStatus.BLOCKED,
      ).length,
    })),
  };
}

/**
 * Skips per channel and reason. A label set counted before reads 0 once its skips leave the
 * window, so an alert on it clears on the next reading.
 */
export function skippedReadings(
  counts: readonly SkippedCount[],
  seen: Set<string>,
): Array<{ channel: string; reason: string; count: number }> {
  const now = new Map<string, { channel: string; reason: string; count: number }>();
  for (const c of counts) {
    const reason = reasonLabel(c.reason);
    const key = `${c.channel}\u0000${reason}`;
    const entry = now.get(key) ?? { channel: c.channel, reason, count: 0 };
    entry.count += c.count;
    now.set(key, entry);
  }
  for (const key of seen) {
    if (now.has(key)) continue;
    const [channel = '', reason = ''] = key.split('\u0000');
    now.set(key, { channel, reason, count: 0 });
  }
  for (const key of now.keys()) seen.add(key);
  return [...now.values()];
}

/**
 * Read on each metric export from Redis and the database, so a restart loses nothing:
 * `notification.breaker.open` and `notification.sender.blocked` (conditions that last) and
 * `notification.skipped.recent` (skips in the last 15 minutes). Every instance reports the same
 * shared state, so a rule takes the `max` over instances. With telemetry off nothing is read.
 */
@Injectable()
export class NotificationStateGauges implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationStateGauges.name);
  private readonly meter = metrics.getMeter('notification-service');
  private readonly breakerOpen: ObservableGauge = this.meter.createObservableGauge(
    NOTIFICATION_INSTRUMENTS.breakerOpen.name,
    { description: 'Breakers open now: sending through them is paused' },
  );
  private readonly senderBlocked: ObservableGauge = this.meter.createObservableGauge(
    NOTIFICATION_INSTRUMENTS.senderBlocked.name,
    { description: 'Live senders the provider blocked: nothing is sent through them' },
  );
  private readonly skippedRecent: ObservableGauge = this.meter.createObservableGauge(
    NOTIFICATION_INSTRUMENTS.skippedRecent.name,
    { description: 'Deliveries skipped in the last 15 minutes' },
  );
  private readonly skippedSeen = new Set<string>();
  private readonly templateProblems: ObservableGauge = this.meter.createObservableGauge(
    NOTIFICATION_INSTRUMENTS.templateProblems.name,
    { description: 'WhatsApp templates that cannot be sent as defined, per reason (ROV-333)' },
  );

  constructor(
    private readonly adapters: ChannelAdapters,
    private readonly breaker: ProviderBreaker,
    private readonly senders: MessagingSenderRepository,
    private readonly stats: DeliveryStatsRepository,
    private readonly templates: MessagingTemplateRepository,
  ) {}

  onModuleInit(): void {
    this.meter.addBatchObservableCallback(this.observe, [this.breakerOpen, this.senderBlocked]);
    this.skippedRecent.addCallback(this.observeSkipped);
    this.templateProblems.addCallback(this.observeTemplates);
  }

  onModuleDestroy(): void {
    this.meter.removeBatchObservableCallback(this.observe, [this.breakerOpen, this.senderBlocked]);
    this.skippedRecent.removeCallback(this.observeSkipped);
    this.templateProblems.removeCallback(this.observeTemplates);
  }

  /** Every reason is reported, 0 included, so an alert on it clears on the next reading. */
  private readonly observeTemplates = async (result: ObservableResult): Promise<void> => {
    let counts: Array<{ problem: string; count: number }>;
    try {
      counts = await this.templates.countProblems();
    } catch (err) {
      this.logger.warn({ err }, 'Could not count WhatsApp template problems');
      return;
    }
    for (const { problem, count } of counts) result.observe(count, { [L.REASON]: problem });
  };

  private readonly observeSkipped = async (result: ObservableResult): Promise<void> => {
    let counts: SkippedCount[];
    try {
      counts = await this.stats.countSkippedSince(new Date(Date.now() - SKIPPED_RECENT_WINDOW_MS));
    } catch (err) {
      this.logger.warn({ err }, 'Could not count recent skips');
      return;
    }
    for (const { channel, reason, count } of skippedReadings(counts, this.skippedSeen)) {
      result.observe(count, { [L.CHANNEL]: channel, [L.REASON]: reason });
    }
  };

  /** Both readings or neither: a reading of 0 taken while Redis or the database failed would clear an alert. */
  private readonly observe: BatchObservableCallback = async (result) => {
    let readings: StateReadings;
    try {
      const senders = await this.senders.listStates();
      const targets = breakerTargets(this.adapters.all(), senders);
      const open = await this.breaker.openAmong(targets.map((t) => t.name));
      readings = stateReadings(targets, open, senders);
    } catch (err) {
      this.logger.warn({ err }, 'Could not read breaker and sender states');
      return;
    }
    for (const { channel, provider, open } of readings.breakersOpen) {
      result.observe(this.breakerOpen, open, { [L.CHANNEL]: channel, [L.PROVIDER]: provider });
    }
    for (const { channel, blocked } of readings.sendersBlocked) {
      result.observe(this.senderBlocked, blocked, { [L.CHANNEL]: channel });
    }
  };
}
