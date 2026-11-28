import type { NatsConnection } from '@nats-io/nats-core';
import { connect } from '@nats-io/transport-node';
import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ensureStreams, natsServerOptions, STREAMS } from '@roviq/nats-jetstream';

export const NOTIFICATION_INBOX_NATS = Symbol('NOTIFICATION_INBOX_NATS');

export const notificationInboxNatsProvider: Provider = {
  provide: NOTIFICATION_INBOX_NATS,
  inject: [ConfigService],
  useFactory: async (config: ConfigService): Promise<NatsConnection> => {
    const nc = await connect(natsServerOptions(config.getOrThrow<string>('NATS_URL')));
    await ensureStreams(nc, Object.values(STREAMS));
    return nc;
  },
};
