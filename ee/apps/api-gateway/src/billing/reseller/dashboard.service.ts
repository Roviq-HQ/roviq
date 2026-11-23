import { Injectable } from '@nestjs/common';
import { DashboardRepository } from '../repositories/dashboard.repository';

/** Normalize plan interval to monthly factor */
const INTERVAL_MONTHLY_FACTOR: Record<string, number> = {
  /** Monthly plan — 1x per month */
  MONTHLY: 1,
  /** Quarterly plan — ÷3 to get monthly */
  QUARTERLY: 1 / 3,
  /** Semi-annual plan — ÷6 to get monthly */
  SEMI_ANNUAL: 1 / 6,
  /** Annual plan — ÷12 to get monthly */
  ANNUAL: 1 / 12,
};

@Injectable()
export class DashboardService {
  constructor(private readonly repo: DashboardRepository) {}

  async getDashboard(resellerId: string) {
    // Churned in last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
    const { activeSubsWithPlans, statusCounts, churned, overdue } =
      await this.repo.findDashboardRows(resellerId, thirtyDaysAgo);

    // MRR: sum of active subscription amounts normalized to monthly
    let mrr = 0n;
    for (const row of activeSubsWithPlans) {
      const factor = INTERVAL_MONTHLY_FACTOR[row.interval] ?? 1;
      mrr += BigInt(Math.round(Number(row.amount) * factor));
    }

    const subscriptionsByStatus: Record<string, number> = {};
    let activeCount = 0;
    for (const row of statusCounts) {
      subscriptionsByStatus[row.status] = row.count;
      if (row.status === 'ACTIVE') activeCount = row.count;
    }

    const churnRate = activeCount + churned > 0 ? churned / (activeCount + churned) : 0;

    return {
      mrr,
      activeSubscriptions: activeCount,
      churnedLast30Days: churned,
      churnRate: Math.round(churnRate * 10000) / 10000,
      overdueInvoiceCount: overdue,
      subscriptionsByStatus,
    };
  }
}
