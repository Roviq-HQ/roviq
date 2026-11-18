import { Module } from '@nestjs/common';
import { DlqConsumer } from './dlq.consumer';
import { DlqService } from './dlq.service';
import { dlqDbProvider } from './dlq-db.provider';
import { DLQ_NATS_CONNECTION, dlqNatsProvider } from './dlq-nats.provider';

@Module({
  providers: [dlqNatsProvider, dlqDbProvider, DlqConsumer, DlqService],
  exports: [DlqService, DLQ_NATS_CONNECTION],
})
export class DlqModule {}
