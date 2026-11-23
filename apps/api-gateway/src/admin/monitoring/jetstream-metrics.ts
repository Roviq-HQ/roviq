import { type JetStreamManager, jetstreamManager } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/nats-core';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  type Attributes,
  type BatchObservableCallback,
  metrics,
  type ObservableGauge,
} from '@opentelemetry/api';
import { DLQ_NATS_CONNECTION } from '../../dlq/dlq-nats.provider';

type Reading = [gauge: ObservableGauge, value: number, attributes: Attributes];

/**
 * JetStream stream and consumer gauges, read on each metric export. With telemetry off the
 * OTel API is a no-op and the callback never runs, so NATS is not polled.
 */
@Injectable()
export class JetStreamMetrics implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JetStreamMetrics.name);
  private readonly meter = metrics.getMeter('api-gateway');
  private readonly streamMessages = this.gauge(
    'jetstream_stream_total_messages',
    'Messages stored in the stream',
  );
  private readonly streamBytes = this.gauge(
    'jetstream_stream_total_bytes',
    'Bytes stored in the stream',
  );
  private readonly streamConsumers = this.gauge(
    'jetstream_stream_consumer_count',
    'Consumers of the stream',
  );
  private readonly consumerPending = this.gauge(
    'jetstream_consumer_num_pending',
    'Messages not yet delivered to the consumer',
  );
  private readonly consumerRedelivered = this.gauge(
    'jetstream_consumer_num_redelivered',
    'Messages the consumer has had redelivered',
  );
  private readonly consumerAckPending = this.gauge(
    'jetstream_consumer_num_ack_pending',
    'Messages delivered to the consumer and awaiting acknowledgement',
  );
  private readonly observables: ObservableGauge[] = [
    this.streamMessages,
    this.streamBytes,
    this.streamConsumers,
    this.consumerPending,
    this.consumerRedelivered,
    this.consumerAckPending,
  ];
  private jsm: Promise<JetStreamManager> | null = null;

  constructor(@Inject(DLQ_NATS_CONNECTION) private readonly nc: NatsConnection) {}

  onModuleInit(): void {
    this.meter.addBatchObservableCallback(this.observe, this.observables);
  }

  onModuleDestroy(): void {
    this.meter.removeBatchObservableCallback(this.observe, this.observables);
  }

  private gauge(name: string, description: string): ObservableGauge {
    return this.meter.createObservableGauge(name, { description });
  }

  private readonly observe: BatchObservableCallback = async (result) => {
    let readings: Reading[];
    try {
      readings = await this.read();
    } catch (err) {
      this.jsm = null;
      this.logger.warn({ err }, 'Could not read JetStream metrics');
      return;
    }
    // Observed only after every read succeeded, so a failed export reports no partial set.
    for (const [gauge, value, attrs] of readings) result.observe(gauge, value, attrs);
  };

  private async read(): Promise<Reading[]> {
    this.jsm ??= jetstreamManager(this.nc);
    const jsm = await this.jsm;
    const readings: Reading[] = [];
    for await (const stream of jsm.streams.list()) {
      const streamName = stream.config.name;
      const streamAttrs = { stream_name: streamName };
      readings.push(
        [this.streamMessages, stream.state.messages, streamAttrs],
        [this.streamBytes, stream.state.bytes, streamAttrs],
        [this.streamConsumers, stream.state.consumer_count, streamAttrs],
      );
      for await (const consumer of jsm.consumers.list(streamName)) {
        const attrs = { stream_name: streamName, consumer_name: consumer.name };
        readings.push(
          [this.consumerPending, consumer.num_pending, attrs],
          [this.consumerRedelivered, consumer.num_redelivered, attrs],
          [this.consumerAckPending, consumer.num_ack_pending, attrs],
        );
      }
    }
    return readings;
  }
}
