import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ClientProxy } from '@nestjs/microservices';
import { DRIZZLE_DB, type DrizzleDB, institutes, withAdmin } from '@roviq/database';
import { subscriptions } from '@roviq/ee-database';
import { eq } from 'drizzle-orm';

/**
 * NATS event consumers for billing → institute lifecycle integration.
 * - subscription.cancelled/expired → suspend institute
 * - invoice.paid (past_due recovery) → reactivate institute
 * - subscription.paused → optional read-only mode
 */
@Injectable()
export class BillingEventConsumer implements OnModuleInit {
  private readonly logger = new Logger(BillingEventConsumer.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDB,
    @Inject('BILLING_NATS_CLIENT') private readonly natsClient: ClientProxy,
  ) {}

  onModuleInit() {
    this.listenForSuspension();
    this.listenForReactivation();
    this.listenForPause();
  }

  /** subscription.cancelled/expired → suspend institute with reason 'billing' */
  private listenForSuspension() {
    for (const pattern of ['BILLING.subscription.cancelled', 'BILLING.subscription.expired']) {
      this.natsClient.send(pattern, {}).subscribe({
        next: async (data: { subscriptionId?: string; tenantId?: string }) => {
          const tenantId = data.tenantId;
          if (!tenantId) return;
          try {
            await withAdmin(this.db, async (tx) => {
              await tx
                .update(institutes)
                .set({ status: 'SUSPENDED', updatedAt: new Date() })
                .where(eq(institutes.id, tenantId));
            });
            this.logger.log(`Institute ${tenantId} suspended due to billing (${pattern})`);
          } catch (err) {
            this.logger.error(`Failed to suspend institute ${tenantId}`, (err as Error).message);
          }
        },
        error: (err) => this.logger.warn(`Failed to subscribe to ${pattern}`, err),
      });
    }
  }

  /** invoice.paid where subscription was past_due → reactivate institute */
  private listenForReactivation() {
    this.natsClient.send('BILLING.payment.succeeded', {}).subscribe({
      next: async (data: { invoiceId?: string; tenantId?: string }) => {
        const tenantId = data.tenantId;
        if (!tenantId) return;
        try {
          // Check if the subscription was past_due
          const sub = await withAdmin(this.db, async (tx) => {
            const [row] = await tx
              .select({ status: subscriptions.status, tenantId: subscriptions.tenantId })
              .from(subscriptions)
              .where(eq(subscriptions.tenantId, tenantId))
              .limit(1);
            return row;
          });

          if (sub?.status === 'PAST_DUE') {
            await withAdmin(this.db, async (tx) => {
              await tx
                .update(subscriptions)
                .set({ status: 'ACTIVE', updatedAt: new Date() })
                .where(eq(subscriptions.tenantId, tenantId));
              await tx
                .update(institutes)
                .set({ status: 'ACTIVE', updatedAt: new Date() })
                .where(eq(institutes.id, tenantId));
            });
            this.logger.log(`Institute ${tenantId} reactivated after payment`);
          }
        } catch (err) {
          this.logger.error(
            `Failed to reactivate institute ${data.tenantId}`,
            (err as Error).message,
          );
        }
      },
      error: (err) => this.logger.warn('Failed to subscribe to payment.succeeded', err),
    });
  }

  /** subscription.paused → log for optional read-only mode */
  private listenForPause() {
    this.natsClient.send('BILLING.subscription.paused', {}).subscribe({
      next: async (data: { subscriptionId?: string; tenantId?: string }) => {
        if (!data.tenantId) return;
        // Optional: could set institute to read-only mode here
        this.logger.log(
          `Subscription paused for institute ${data.tenantId} — read-only mode optional`,
        );
      },
      error: (err) => this.logger.warn('Failed to subscribe to subscription.paused', err),
    });
  }
}
