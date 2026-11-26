import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { ResellerStatus } from '@roviq/common-types';
import { EVENT_PATTERNS, eventPayloadSchemas, gatewayConsumer } from '@roviq/nats-jetstream';
import { TemporalClientService } from '@roviq/temporal';
import { BILLING_TASK_QUEUE } from './workflows/billing.worker';

const SUBJECT = EVENT_PATTERNS.RESELLER.status_changed;

/**
 * One id per deletion: Temporal refuses a second start of it, so a redelivered event starts
 * nothing, while a later deletion of the same reseller id still gets its own cleanup.
 */
export const resellerCleanupWorkflowId = (resellerId: string, deletedAt: Date) =>
  `reseller-deletion-cleanup-${resellerId}-${deletedAt.getTime()}`;

/** Starts the billing cleanup of a deleted reseller: its subscriptions move to Roviq Direct. */
@Controller()
export class ResellerDeletionConsumer {
  private readonly logger = new Logger(ResellerDeletionConsumer.name);

  constructor(private readonly temporal: TemporalClientService) {}

  @EventPattern(SUBJECT, gatewayConsumer(SUBJECT))
  async onStatusChanged(@Payload() data: unknown): Promise<void> {
    const { id, newStatus, deletedAt } = eventPayloadSchemas[SUBJECT].parse(data);
    if (newStatus !== ResellerStatus.DELETED) return;
    if (!deletedAt)
      throw new Error(`RESELLER.status_changed DELETED for ${id} carries no deletedAt`);

    const started = await this.temporal.startWorkflowOnce('resellerDeletionCleanupWorkflow', {
      taskQueue: BILLING_TASK_QUEUE,
      workflowId: resellerCleanupWorkflowId(id, deletedAt),
      args: [id],
    });
    this.logger.log(
      started
        ? `Started billing cleanup of deleted reseller ${id}`
        : `Billing cleanup of reseller ${id} was already started; redelivery ignored`,
    );
  }
}
