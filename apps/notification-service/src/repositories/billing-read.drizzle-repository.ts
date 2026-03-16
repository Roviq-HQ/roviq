import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  i18nDisplay,
  organizations,
  subscriptionPlans,
  subscriptions,
  users,
  withAdmin,
} from '@roviq/database';
import { eq } from 'drizzle-orm';
import { BillingReadRepository } from './billing-read.repository';
import type { SubscriptionDetails, UserIdRecord } from './types';

@Injectable()
export class BillingReadDrizzleRepository extends BillingReadRepository {
  private readonly logger = new Logger(BillingReadDrizzleRepository.name);

  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async findSubscriptionDetails(subscriptionId: string): Promise<SubscriptionDetails | null> {
    return withAdmin(this.db, async (tx) => {
      const result = await tx
        .select({
          subscriptionId: subscriptions.id,
          organizationId: subscriptions.organizationId,
          organizationName: organizations.name,
          planName: subscriptionPlans.name,
          planAmount: subscriptionPlans.amount,
          planCurrency: subscriptionPlans.currency,
        })
        .from(subscriptions)
        .innerJoin(subscriptionPlans, eq(subscriptions.planId, subscriptionPlans.id))
        .innerJoin(organizations, eq(subscriptions.organizationId, organizations.id))
        .where(eq(subscriptions.id, subscriptionId))
        .limit(1);

      if (!result[0]) {
        this.logger.warn(`Subscription ${subscriptionId} not found for notification`);
        return null;
      }

      const row = result[0];
      return {
        subscriptionId: row.subscriptionId,
        organizationId: row.organizationId,
        organizationName: i18nDisplay(row.organizationName),
        planName: i18nDisplay(row.planName),
        planAmount: row.planAmount,
        planCurrency: row.planCurrency,
      };
    });
  }

  async findPlatformAdminUser(): Promise<UserIdRecord | null> {
    return withAdmin(this.db, async (tx) => {
      const result = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, 'admin'))
        .limit(1);

      return result[0] ?? null;
    });
  }
}
