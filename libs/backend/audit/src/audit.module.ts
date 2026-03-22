import { Module } from '@nestjs/common';
import { AuditEmitter } from './audit-emitter';

/**
 * Provides AuditEmitter for service-level audit event emission.
 *
 * Requires JETSTREAM_CLIENT to be available in the DI container
 * (provided by NatsJetStreamModule in api-gateway).
 *
 * Usage:
 * ```typescript
 * @Module({ imports: [AuditModule] })
 * export class MyFeatureModule {}
 * ```
 */
@Module({
  providers: [AuditEmitter],
  exports: [AuditEmitter],
})
export class AuditModule {}
