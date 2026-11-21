import { Module } from '@nestjs/common';
import { TemporalClientService } from './temporal-client.service';

@Module({
  providers: [TemporalClientService],
  exports: [TemporalClientService],
})
export class TemporalClientModule {}
