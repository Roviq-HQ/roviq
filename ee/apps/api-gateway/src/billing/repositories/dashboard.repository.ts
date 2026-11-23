import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DB, type DrizzleDB, mkResellerCtx, withReseller } from '@roviq/database';
import { invoices, plans, subscriptions } from '@roviq/ee-database';
import { and, count, eq, gte } from 'drizzle-orm';

export interface ResellerDashboardRows {
  activeSubsWithPlans: Pick<typeof plans.$inferSelect, 'amount' | 'interval'>[];
  statusCounts: { status: (typeof subscriptions.$inferSelect)['status']; count: number }[];
  churned: number;
  overdue: number;
}

@Injectable()
export class DashboardRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  /** The reseller's billing figures in one transaction; RLS limits every row to the reseller. */
  async findDashboardRows(resellerId: string, churnedSince: Date): Promise<ResellerDashboardRows> {
    return withReseller(
      this.db,
      mkResellerCtx(resellerId, 'service:reseller-dashboard'),
      async (tx) => {
        const activeSubsWithPlans = await tx
          .select({
            amount: plans.amount,
            interval: plans.interval,
          })
          .from(subscriptions)
          .innerJoin(plans, eq(subscriptions.planId, plans.id)) // allow-base-read: billing records keep their plan after it is deleted
          .where(eq(subscriptions.status, 'ACTIVE'));

        const statusCounts = await tx
          .select({ status: subscriptions.status, count: count() })
          .from(subscriptions)
          .groupBy(subscriptions.status);

        const [{ churned }] = await tx
          .select({ churned: count() })
          .from(subscriptions)
          .where(
            and(
              eq(subscriptions.status, 'CANCELLED'),
              gte(subscriptions.cancelledAt, churnedSince),
            ),
          );

        const [{ overdue }] = await tx
          .select({ overdue: count() })
          .from(invoices)
          .where(eq(invoices.status, 'OVERDUE'));

        return { activeSubsWithPlans, statusCounts, churned, overdue };
      },
    );
  }
}
