import type { NatsConnection } from '@nats-io/nats-core';
import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type pg from 'pg';
import { DlqConsumer } from './dlq.consumer';
import { DlqService } from './dlq.service';
import { DLQ_DB_POOL, dlqDbProvider } from './dlq-db.provider';
import { DLQ_NATS_CONNECTION, dlqNatsProvider } from './dlq-nats.provider';
import { DlqRepositoryModule } from './repositories/dlq-repository.module';

@Module({
  imports: [DlqRepositoryModule],
  providers: [dlqNatsProvider, dlqDbProvider, DlqConsumer, DlqService],
  exports: [DlqService, DLQ_NATS_CONNECTION],
})
export class DlqModule implements OnApplicationShutdown {
  constructor(
    @Inject(DLQ_NATS_CONNECTION) private readonly nc: NatsConnection,
    @Inject(DLQ_DB_POOL) private readonly pool: pg.Pool,
  ) {}

  // Last: health checks and DlqService share the connection until the app has closed.
  async onApplicationShutdown(): Promise<void> {
    await this.nc.close();
    await this.pool.end();
  }
}
