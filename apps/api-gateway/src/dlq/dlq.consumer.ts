import {
  AckPolicy,
  type ConsumerMessages,
  type JetStreamClient,
  jetstream,
  jetstreamManager,
} from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/nats-core';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { DEFAULT_DLQ_STREAM, DLQ_READER_CONSUMER, type DlqMessage } from '@roviq/nats-jetstream';
import type pg from 'pg';
import { DLQ_DB_POOL } from './dlq-db.provider';
import { DLQ_NATS_CONNECTION } from './dlq-nats.provider';

/** Defer redelivery 5s on a transient persist failure. */
const NAK_DELAY_MS = 5000;

export interface DlqRow {
  dlqStreamSeq: bigint;
  originalSubject: string;
  originStream: string;
  payload: unknown;
  error: string;
  retryCount: number;
  correlationId: string;
  tenantId: string | null;
  failedAt: string;
}

export function toDlqRow(msg: DlqMessage, dlqStreamSeq: bigint): DlqRow {
  return {
    dlqStreamSeq,
    originalSubject: msg.originalSubject,
    originStream: msg.originalSubject.split('.')[0]?.toUpperCase() ?? 'UNKNOWN',
    payload: msg.payload,
    error: msg.error,
    retryCount: msg.retryCount,
    correlationId: msg.correlationId,
    tenantId: msg.tenantId ?? null,
    failedAt: msg.failedAt,
  };
}

/**
 * NATS JetStream pull consumer on the DLQ stream (DLQ.>). Persists each
 * dead-lettered envelope to dlq_messages, alerts via structured log + metric,
 * then acks. Mirrors AuditConsumer: deferred ack (nak on failure → redelivery,
 * never silently lost) and idempotent ON CONFLICT on the DLQ stream sequence.
 */
@Injectable()
export class DlqConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DlqConsumer.name);
  private readonly meter = metrics.getMeter('dlq');
  private readonly dlqMessages = this.meter.createCounter('nats_dlq_messages_total', {
    description: 'Total messages dead-lettered and persisted',
  });
  private consumerMessages: ConsumerMessages | null = null;
  private js!: JetStreamClient;

  constructor(
    @Inject(DLQ_NATS_CONNECTION) private readonly nc: NatsConnection,
    @Inject(DLQ_DB_POOL) private readonly pool: pg.Pool,
  ) {}

  async onModuleInit(): Promise<void> {
    this.js = jetstream(this.nc);
    await this.ensureConsumer();
    void this.startConsuming();
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumerMessages?.close();
    await this.pool.end();
  }

  private async ensureConsumer(): Promise<void> {
    const jsm = await jetstreamManager(this.nc);
    try {
      await jsm.consumers.info(DEFAULT_DLQ_STREAM.name, DLQ_READER_CONSUMER.durable_name);
      return;
    } catch {
      this.logger.log(`Consumer ${DLQ_READER_CONSUMER.durable_name} not found, creating...`);
    }
    await jsm.consumers.add(DEFAULT_DLQ_STREAM.name, {
      durable_name: DLQ_READER_CONSUMER.durable_name,
      filter_subject: DLQ_READER_CONSUMER.filter_subject,
      ack_policy: AckPolicy.Explicit,
      max_deliver: DLQ_READER_CONSUMER.max_deliver,
    });
  }

  private async startConsuming(): Promise<void> {
    const consumer = await this.js.consumers.get(
      DEFAULT_DLQ_STREAM.name,
      DLQ_READER_CONSUMER.durable_name,
    );

    try {
      const messages = await consumer.consume();
      this.consumerMessages = messages;

      for await (const msg of messages) {
        try {
          const dlq = msg.json<DlqMessage>();
          const row = toDlqRow(dlq, BigInt(msg.seq));
          await this.persist(row);
          this.logger.error(
            {
              'dlq.message': true,
              'dlq.subject': row.originalSubject,
              'dlq.origin_stream': row.originStream,
              'dlq.error': row.error,
              'dlq.retry_count': row.retryCount,
              correlation_id: row.correlationId,
            },
            `Message dead-lettered: ${row.originalSubject}`,
          );
          this.dlqMessages.add(1, { origin_stream: row.originStream });
          msg.ack();
        } catch (err) {
          // Do not ack — defer for redelivery so the message is never lost.
          this.logger.error(`Failed to persist DLQ message (seq ${msg.seq})`, err);
          msg.nak(NAK_DELAY_MS);
        }
      }
    } catch (err) {
      if (!(err instanceof Error && err.message.includes('closed'))) {
        this.logger.error('DLQ consumer error', err);
      }
    }
  }

  private async persist(row: DlqRow): Promise<void> {
    const query = `
      INSERT INTO dlq_messages (
        dlq_stream_seq, original_subject, origin_stream, payload,
        error, retry_count, correlation_id, tenant_id, failed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (dlq_stream_seq) DO NOTHING
    `;
    await this.pool.query(query, [
      row.dlqStreamSeq.toString(),
      row.originalSubject,
      row.originStream,
      row.payload === null ? null : JSON.stringify(row.payload),
      row.error,
      row.retryCount,
      row.correlationId,
      row.tenantId,
      row.failedAt,
    ]);
  }
}
