import { Injectable } from '@nestjs/common';
import { type Attributes, metrics, type ObservableResult } from '@opentelemetry/api';
import {
  NOTIFICATION_SKIP_REASON_VALUES,
  type NotificationChannel,
  type NotificationDeliveryStatus,
} from '@roviq/common-types';
import { isTableCode } from '../delivery/adapters/adapter-errors';
import type { WrittenDelivery } from '../repositories/types';

/**
 * Every label any notification metric carries. Only bounded, non-personal values: never a user
 * id, an address, a phone number or an institute.
 */
export const NOTIFICATION_METRIC_LABELS = {
  CHANNEL: 'channel',
  STATUS: 'status',
  PROVIDER: 'provider',
  REASON: 'reason',
  STREAM: 'stream',
  CONSUMER: 'consumer',
} as const;

type LabelName = (typeof NOTIFICATION_METRIC_LABELS)[keyof typeof NOTIFICATION_METRIC_LABELS];
const L = NOTIFICATION_METRIC_LABELS;

/** Instrument names (OpenObserve series: dots become underscores) and the labels each one uses. */
export const NOTIFICATION_INSTRUMENTS = {
  delivery: { name: 'notification.delivery', labels: [L.CHANNEL, L.STATUS, L.PROVIDER, L.REASON] },
  deliveryDuration: { name: 'notification.delivery.duration', labels: [L.CHANNEL, L.PROVIDER] },
  deferred: { name: 'notification.deferred', labels: [L.CHANNEL, L.REASON] },
  breakerOpened: {
    name: 'notification.breaker.opened',
    labels: [L.CHANNEL, L.PROVIDER, L.REASON],
  },
  eventLag: { name: 'notification.event.lag', labels: [L.STREAM, L.CONSUMER] },
  canaryLastSuccess: { name: 'notification.canary.last_success', labels: [L.CHANNEL] },
  workerRunning: { name: 'notification.worker.running', labels: [] },
} as const satisfies Record<string, { name: string; labels: readonly LabelName[] }>;

const NONE = 'none';
/** A failure code outside the adapter table: kept out of the label so its values stay bounded. */
const OTHER = 'other';

const isSkipReason = (value: string) =>
  NOTIFICATION_SKIP_REASON_VALUES.some((reason) => reason === value);

/**
 * The `reason` label: a skip or defer reason, or an adapter error code without its numeric
 * SMTP reply (`EAUTH_535` → `EAUTH`); `none` when there is neither.
 */
export function reasonLabel(code: string | null): string {
  if (code === null || code === '') return NONE;
  if (isSkipReason(code)) return code;
  const base = /^(.+)_\d+$/.exec(code)?.[1] ?? code;
  return isTableCode(base) ? base : OTHER;
}

/** One `notification_deliveries` row as the metric sees it. */
export interface DeliveryRowMetric {
  channel: NotificationChannel;
  status: NotificationDeliveryStatus;
  provider: string | null;
  /** The row's skip reason or error code. */
  reason: string | null;
}

export function deliveryAttributes(row: DeliveryRowMetric): Attributes {
  return {
    [L.CHANNEL]: row.channel,
    [L.STATUS]: row.status,
    [L.PROVIDER]: row.provider ?? NONE,
    [L.REASON]: reasonLabel(row.reason),
  };
}

/**
 * The notification service's own delivery metrics. With telemetry off the OpenTelemetry API is a
 * no-op, so every call here costs nothing.
 */
@Injectable()
export class NotificationMetrics {
  private readonly meter = metrics.getMeter('notification-service');
  private readonly deliveries = this.meter.createCounter(NOTIFICATION_INSTRUMENTS.delivery.name, {
    description: 'notification_deliveries rows written, deferrals excluded',
  });
  private readonly duration = this.meter.createHistogram(
    NOTIFICATION_INSTRUMENTS.deliveryDuration.name,
    { description: 'Time of one provider call', unit: 'ms' },
  );
  private readonly deferrals = this.meter.createCounter(NOTIFICATION_INSTRUMENTS.deferred.name, {
    description:
      'Messages held for later (quiet hours, a full or slowed sender, a paused provider)',
  });
  private readonly breakers = this.meter.createCounter(
    NOTIFICATION_INSTRUMENTS.breakerOpened.name,
    {
      description: 'A provider or sender breaker opened: sending through it pauses',
    },
  );
  private readonly canaryGauge = this.meter.createObservableGauge(
    NOTIFICATION_INSTRUMENTS.canaryLastSuccess.name,
    { description: 'Unix seconds of the last canary the provider accepted', unit: 's' },
  );
  private readonly canarySuccess = new Map<NotificationChannel, number>();

  constructor() {
    this.canaryGauge.addCallback(this.observeCanary);
  }

  delivery(row: DeliveryRowMetric): void {
    this.deliveries.add(1, deliveryAttributes(row));
  }

  /** Rows a provider's report or a device's acknowledgement appended. */
  reported(rows: readonly WrittenDelivery[]): void {
    for (const row of rows) {
      this.delivery({
        channel: row.channel,
        status: row.status,
        provider: row.provider,
        reason: row.errorCode,
      });
    }
  }

  providerCall(channel: NotificationChannel, provider: string, ms: number): void {
    this.duration.record(ms, { [L.CHANNEL]: channel, [L.PROVIDER]: provider });
  }

  deferred(channel: NotificationChannel, reason: string): void {
    this.deferrals.add(1, { [L.CHANNEL]: channel, [L.REASON]: reasonLabel(reason) });
  }

  /** No sender id: the label set stays bounded. `reason` is the failure code that opened it. */
  breakerOpened(channel: NotificationChannel, provider: string, reason: string): void {
    this.breakers.add(1, {
      [L.CHANNEL]: channel,
      [L.PROVIDER]: provider,
      [L.REASON]: reasonLabel(reason),
    });
  }

  /** Keeps the latest time per channel, so a seed read after a live success cannot move it back. */
  canarySucceeded(channel: NotificationChannel, at: Date): void {
    const seconds = Math.floor(at.getTime() / 1000);
    const known = this.canarySuccess.get(channel);
    if (known === undefined || seconds > known) this.canarySuccess.set(channel, seconds);
  }

  canaryLastSuccess(channel: NotificationChannel): number | undefined {
    return this.canarySuccess.get(channel);
  }

  private readonly observeCanary = (result: ObservableResult): void => {
    for (const [channel, seconds] of this.canarySuccess) {
      result.observe(seconds, { [L.CHANNEL]: channel });
    }
  };
}
