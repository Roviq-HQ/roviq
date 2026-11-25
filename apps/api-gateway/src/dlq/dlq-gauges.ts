import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { metrics, type ObservableResult } from '@opentelemetry/api';
import { DlqRepository, type DlqStreamCount } from './repositories/dlq.repository';

/** The span `nats_dlq_messages_recent` counts over. */
export const DLQ_RECENT_WINDOW_MS = 5 * 60_000;

/**
 * Per origin stream. A stream counted before reads 0 once its rows leave the window, so an
 * alert on it clears on the next reading.
 */
export function dlqRecentReadings(
  counts: readonly DlqStreamCount[],
  seen: Set<string>,
): Array<{ originStream: string; count: number }> {
  const now = new Map(counts.map((c) => [c.originStream, c.count]));
  for (const stream of seen) if (!now.has(stream)) now.set(stream, 0);
  for (const stream of now.keys()) seen.add(stream);
  return [...now].map(([originStream, count]) => ({ originStream, count }));
}

/**
 * `nats_dlq_messages_recent`: rows dead-lettered in the last 5 minutes, read from `dlq_messages`
 * on each metric export. `nats_dlq_messages_total` cannot carry an alert on one message: its
 * series restarts at 1 with each gateway, and a series born at 1 has no increase.
 */
@Injectable()
export class DlqGauges implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DlqGauges.name);
  private readonly gauge = metrics
    .getMeter('dlq')
    .createObservableGauge('nats_dlq_messages_recent', {
      description: 'Messages dead-lettered in the last 5 minutes',
    });
  private readonly seen = new Set<string>();

  constructor(private readonly repo: DlqRepository) {}

  onModuleInit(): void {
    this.gauge.addCallback(this.observe);
  }

  onModuleDestroy(): void {
    this.gauge.removeCallback(this.observe);
  }

  private readonly observe = async (result: ObservableResult): Promise<void> => {
    let counts: DlqStreamCount[];
    try {
      counts = await this.repo.countSinceByStream(new Date(Date.now() - DLQ_RECENT_WINDOW_MS));
    } catch (err) {
      this.logger.warn({ err }, 'Could not count recent dead letters');
      return;
    }
    for (const { originStream, count } of dlqRecentReadings(counts, this.seen)) {
      result.observe(count, { origin_stream: originStream });
    }
  };
}
