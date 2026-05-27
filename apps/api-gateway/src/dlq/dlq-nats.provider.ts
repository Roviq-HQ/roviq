import type { NatsConnection } from '@nats-io/nats-core';
import { connect } from '@nats-io/transport-node';
import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ensureStreams, STREAMS } from '@roviq/nats-jetstream';

export const DLQ_NATS_CONNECTION = Symbol('DLQ_NATS_CONNECTION');

export const dlqNatsProvider: Provider = {
  provide: DLQ_NATS_CONNECTION,
  inject: [ConfigService],
  useFactory: async (config: ConfigService): Promise<NatsConnection> => {
    const nc = await connect({ servers: config.getOrThrow<string>('NATS_URL') });
    await ensureStreams(nc, Object.values(STREAMS));
    return nc;
  },
};
