/**
 * Global module that provides EventBusService.
 *
 * Imported once in AppModule — all feature modules can then
 * inject EventBusService without importing this module explicitly.
 */
import { Global, Module } from '@nestjs/common';
import { EventBusService } from './event-bus.service';

@Global()
@Module({
  providers: [EventBusService],
  exports: [EventBusService],
})
export class EventBusModule {}
