import { type ConsumerInfo, type JetStreamManager, jetstreamManager } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/nats-core';
import { connect } from '@nats-io/transport-node';
import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type BatchObservableCallback,
  metrics,
  type ObservableGauge,
  type ObservableResult,
} from '@opentelemetry/api';
import { STREAMS } from '@roviq/nats-jetstream';
import { NotificationWorkerService } from '../workflows/notification.worker';
import { NOTIFICATION_METRIC_LABELS as L, NOTIFICATION_INSTRUMENTS } from './notification-metrics';

export const NOTIFICATION_STREAM = STREAMS.NOTIFICATION?.name ?? 'NOTIFICATION';

/** The parts of a consumer's state its lag is read from. */
export type ConsumerLagInfo = Pick<
  ConsumerInfo,
  'name' | 'num_pending' | 'num_ack_pending' | 'ack_floor'
> & { config: Pick<ConsumerInfo['config'], 'filter_subject'> };

/** The oldest message a consumer has not acknowledged yet, or null when none is waiting. */
export type OldestUnhandled = (consumer: ConsumerLagInfo) => Promise<Date | null>;

/**
 * Seconds the oldest unhandled event of each consumer has waited; 0 when none is waiting. A
 * consumer whose oldest message cannot be read is left out of this reading.
 */
export async function eventLags(
  consumers: AsyncIterable<ConsumerLagInfo>,
  oldestUnhandled: OldestUnhandled,
  now: Date,
): Promise<Array<{ consumer: string; seconds: number }>> {
  const lags: Array<{ consumer: string; seconds: number }> = [];
  for await (const consumer of consumers) {
    const waiting = consumer.num_pending + consumer.num_ack_pending;
    if (waiting === 0) {
      lags.push({ consumer: consumer.name, seconds: 0 });
      continue;
    }
    const oldest = await oldestUnhandled(consumer);
    const seconds = oldest === null ? 0 : (now.getTime() - oldest.getTime()) / 1000;
    lags.push({ consumer: consumer.name, seconds: Math.max(0, Math.round(seconds)) });
  }
  return lags;
}

/**
 * `notification.event.lag` and `notification.worker.running`, read on each metric export. With
 * telemetry off the callbacks never run, so NATS is not polled.
 */
@Injectable()
export class NotificationGauges implements OnModuleInit, OnModuleDestroy, OnApplicationShutdown {
  private readonly logger = new Logger(NotificationGauges.name);
  private readonly meter = metrics.getMeter('notification-service');
  private readonly eventLag: ObservableGauge = this.meter.createObservableGauge(
    NOTIFICATION_INSTRUMENTS.eventLag.name,
    {
      description: 'Age of the oldest unhandled event of each NOTIFICATION consumer; 0 when none',
      unit: 's',
    },
  );
  private readonly workerRunning: ObservableGauge = this.meter.createObservableGauge(
    NOTIFICATION_INSTRUMENTS.workerRunning.name,
    { description: '1 while the Temporal worker runs or starts, 0 once it stopped' },
  );
  private nc: Promise<NatsConnection> | null = null;
  private jsm: Promise<JetStreamManager> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly worker: NotificationWorkerService,
  ) {}

  onModuleInit(): void {
    this.meter.addBatchObservableCallback(this.observeLag, [this.eventLag]);
    this.workerRunning.addCallback(this.observeWorker);
  }

  onModuleDestroy(): void {
    this.meter.removeBatchObservableCallback(this.observeLag, [this.eventLag]);
    this.workerRunning.removeCallback(this.observeWorker);
  }

  async onApplicationShutdown(): Promise<void> {
    const nc = this.nc;
    this.nc = null;
    this.jsm = null;
    if (nc) await (await nc).close();
  }

  /** Mirrors the health endpoint: only a stopped worker is down; a disabled one reports nothing. */
  private readonly observeWorker = (result: ObservableResult): void => {
    const state = this.worker.workerStatus;
    if (state === 'disabled') return;
    result.observe(state === 'stopped' ? 0 : 1);
  };

  private readonly observeLag: BatchObservableCallback = async (result) => {
    let lags: Array<{ consumer: string; seconds: number }>;
    try {
      const jsm = await this.manager();
      lags = await eventLags(
        jsm.consumers.list(NOTIFICATION_STREAM),
        (consumer) => this.oldestUnhandled(jsm, consumer),
        new Date(),
      );
    } catch (err) {
      this.jsm = null;
      this.logger.warn({ err }, 'Could not read NOTIFICATION consumer lag');
      return;
    }
    for (const { consumer, seconds } of lags) {
      result.observe(this.eventLag, seconds, {
        [L.STREAM]: NOTIFICATION_STREAM,
        [L.CONSUMER]: consumer,
      });
    }
  };

  private manager(): Promise<JetStreamManager> {
    this.nc ??= connect({ servers: this.config.getOrThrow<string>('NATS_URL') });
    this.jsm ??= this.nc.then((nc) => jetstreamManager(nc));
    return this.jsm;
  }

  // The first message after the consumer's acknowledgement floor that its filter matches.
  private async oldestUnhandled(
    jsm: JetStreamManager,
    consumer: ConsumerLagInfo,
  ): Promise<Date | null> {
    const seq = consumer.ack_floor.stream_seq + 1;
    const filter = consumer.config.filter_subject;
    // The server's message-get request takes `next_by_subj`; the client's type names only `seq`.
    const query = filter ? { seq, next_by_subj: filter } : { seq };
    const message = await jsm.streams.getMessage(NOTIFICATION_STREAM, query);
    return message?.time ?? null;
  }
}
