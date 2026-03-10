import type { NatsConnection } from '@nats-io/nats-core';
import { publish } from '@roviq/nats-utils';

export interface AuditEvent {
  tenantId: string;
  userId: string;
  actorId: string;
  impersonatorId?: string;
  action: string;
  actionType: 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE' | 'ASSIGN' | 'REVOKE';
  entityType: string;
  entityId?: string;
  changes?: Record<string, { old: unknown; new: unknown }> | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string;
  userAgent?: string;
  source: string;
}

export async function emitAuditEvent(
  nc: NatsConnection,
  event: AuditEvent,
  correlationId: string,
): Promise<void> {
  await publish(nc, 'AUDIT.log', event, {
    correlationId,
    tenantId: event.tenantId,
  });
}
