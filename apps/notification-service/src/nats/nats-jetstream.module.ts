import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JetStreamClient } from '@roviq/nats-jetstream';

/** The publishing side, for EventBusService (`NOTIFICATION.inapp.created`). */
@Global()
@Module({
  providers: [
    {
      provide: 'JETSTREAM_CLIENT',
      useFactory: async (config: ConfigService) => {
        const client = new JetStreamClient({
          servers: [config.getOrThrow<string>('NATS_URL')],
        });
        await client.connect();
        return client;
      },
      inject: [ConfigService],
    },
  ],
  exports: ['JETSTREAM_CLIENT'],
})
export class NatsJetStreamModule implements OnApplicationShutdown {
  constructor(@Inject('JETSTREAM_CLIENT') private readonly client: JetStreamClient) {}

  // After HTTP and consumers stopped, so the events they emitted while finishing are published.
  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }
}
