import { Global, Module } from '@nestjs/common';
import { NATS_CONNECTION, natsConnectionProvider } from './nats.provider';

@Global()
@Module({
  providers: [natsConnectionProvider],
  exports: [NATS_CONNECTION],
})
export class NatsModule {}
