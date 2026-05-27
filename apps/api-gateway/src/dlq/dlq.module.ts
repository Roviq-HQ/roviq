import { Module } from '@nestjs/common';
import { DlqConsumer } from './dlq.consumer';
import { DlqResolver } from './dlq.resolver';
import { DlqService } from './dlq.service';
import { dlqDbProvider } from './dlq-db.provider';
import { dlqNatsProvider } from './dlq-nats.provider';

@Module({
  providers: [dlqNatsProvider, dlqDbProvider, DlqConsumer, DlqService, DlqResolver],
})
export class DlqModule {}
