/** The reseller billing dashboard reads only the caller reseller's subscriptions and invoices. */
import { BillingInterval } from '@roviq/ee-billing-types';
import {
  createIntegrationApp,
  createResellerToken,
  createTestInstitute,
  createTestReseller,
  gqlRequest,
  type IntegrationAppResult,
} from '@roviq/testing/integration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app/app.module';

const DASHBOARD = `query {
  resellerBillingDashboard {
    mrr activeSubscriptions churnedLast30Days churnRate overdueInvoiceCount subscriptionsByStatus
  }
}`;
const CREATE_PLAN = `mutation ($input: CreatePlanInput!) { createSubscriptionPlan(input: $input) { id } }`;
const ASSIGN = `mutation ($input: AssignPlanInput!) {
  assignPlanToInstitute(input: $input) { subscription { id status } }
}`;

interface Dashboard {
  mrr: number;
  activeSubscriptions: number;
  churnedLast30Days: number;
  churnRate: number;
  overdueInvoiceCount: number;
  subscriptionsByStatus: Record<string, number>;
}

describe('Reseller billing dashboard (integration)', () => {
  let result: IntegrationAppResult;
  let token: string;
  let otherToken: string;

  const dashboard = async (as: string) => {
    const res = await gqlRequest<{ resellerBillingDashboard: Dashboard }>(result.httpServer, {
      query: DASHBOARD,
      token: as,
    });
    expect(res.errors).toBeUndefined();
    return res.data?.resellerBillingDashboard;
  };

  beforeAll(async () => {
    // EeModule registers BillingModule only when these are set before AppModule boots.
    process.env.ROVIQ_EE = 'true';
    process.env.BILLING_ENCRYPTION_KEY =
      process.env.BILLING_ENCRYPTION_KEY ??
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    result = await createIntegrationApp({ modules: [AppModule] });

    const reseller = await createTestReseller(result.db);
    const other = await createTestReseller(result.db);
    const institute = await createTestInstitute(result.db, { resellerId: reseller.resellerId });
    token = createResellerToken({
      sub: reseller.userId,
      resellerId: reseller.resellerId,
      membershipId: reseller.membershipId,
      roleId: reseller.roleId,
    });
    otherToken = createResellerToken({
      sub: other.userId,
      resellerId: other.resellerId,
      membershipId: other.membershipId,
      roleId: other.roleId,
    });

    const plan = await gqlRequest<{ createSubscriptionPlan: { id: string } }>(result.httpServer, {
      query: CREATE_PLAN,
      token,
      variables: {
        input: {
          name: { en: 'Quarterly Plan' },
          code: `quarterly-${Date.now()}`,
          interval: BillingInterval.QUARTERLY,
          amount: '300000',
          currency: 'INR',
          trialDays: 0,
          entitlements: {
            maxStudents: 500,
            maxStaff: 50,
            maxStorageMb: 1024,
            auditLogRetentionDays: 30,
            features: [],
          },
        },
      },
    });
    expect(plan.errors).toBeUndefined();
    const assigned = await gqlRequest(result.httpServer, {
      query: ASSIGN,
      token,
      variables: {
        input: { tenantId: institute.tenantId, planId: plan.data?.createSubscriptionPlan.id },
      },
    });
    expect(assigned.errors).toBeUndefined();
  });

  afterAll(async () => {
    await result?.close();
  });

  it('should normalise the active subscription to a monthly amount', async () => {
    expect(await dashboard(token)).toEqual({
      mrr: 100000,
      activeSubscriptions: 1,
      churnedLast30Days: 0,
      churnRate: 0,
      overdueInvoiceCount: 0,
      subscriptionsByStatus: { ACTIVE: 1 },
    });
  });

  it("should not count another reseller's subscriptions", async () => {
    expect(await dashboard(otherToken)).toEqual({
      mrr: 0,
      activeSubscriptions: 0,
      churnedLast30Days: 0,
      churnRate: 0,
      overdueInvoiceCount: 0,
      subscriptionsByStatus: {},
    });
  });
});
