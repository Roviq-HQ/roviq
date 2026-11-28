/**
 * ROV-399: a subscription has one live invoice per billing period. `generateInvoice` refuses a
 * period that already has one, and PostgreSQL refuses the second row for every role.
 */
import { randomUUID } from 'node:crypto';
import { ErrorCode } from '@roviq/common-types';
import {
  type DrizzleDB,
  mkAdminCtx,
  mkResellerCtx,
  SYSTEM_USER_ID,
  withAdmin,
  withReseller,
} from '@roviq/database';
import { invoices, plans, subscriptions } from '@roviq/ee-database';
import {
  createIntegrationApp,
  createResellerToken,
  createTestInstitute,
  createTestReseller,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
  type TestReseller,
} from '@roviq/testing/integration';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app/app.module';

const ORIGIN = 'test:billing-invoice-period';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
const DAY = 86_400_000;

const ASSIGN = /* GraphQL */ `
  mutation ($tenantId: String!, $planId: String!) {
    assignPlanToInstitute(input: { tenantId: $tenantId, planId: $planId }) {
      subscription {
        id
      }
    }
  }
`;
const GENERATE_INVOICE = /* GraphQL */ `
  mutation ($tenantId: ID!, $subscriptionId: ID!) {
    generateInvoice(input: { tenantId: $tenantId, subscriptionId: $subscriptionId }) {
      id
      periodStart
    }
  }
`;

describe('one invoice per subscription and billing period (ROV-399)', () => {
  let result: IntegrationAppResult;
  let reseller: TestReseller;
  let token: string;
  let planId: string;

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  const newInstitute = (): Promise<TestInstitute> =>
    createTestInstitute(result.db, { resellerId: reseller.resellerId });

  const addSubscription = (tenantId: string) =>
    asAdmin(async (tx) => {
      const now = Date.now();
      const [subscription] = await tx
        .insert(subscriptions)
        .values({
          tenantId,
          resellerId: reseller.resellerId,
          planId,
          status: 'ACTIVE',
          currentPeriodStart: new Date(now - 5 * DAY),
          currentPeriodEnd: new Date(now + 25 * DAY),
          ...BY,
        })
        .returning({ id: subscriptions.id, periodStart: subscriptions.currentPeriodStart });
      return subscription;
    });

  const invoicesOf = (subscriptionId: string) =>
    asAdmin((tx) =>
      tx
        .select({ id: invoices.id, status: invoices.status, periodStart: invoices.periodStart })
        .from(invoices)
        .where(eq(invoices.subscriptionId, subscriptionId))
        .orderBy(asc(invoices.id)),
    );

  const generate = (tenantId: string, subscriptionId: string) =>
    gqlRequest<{ generateInvoice: { id: string } }>(result.httpServer, {
      query: GENERATE_INVOICE,
      variables: { tenantId, subscriptionId },
      token,
    });

  beforeAll(async () => {
    process.env.ROVIQ_EE = 'true';
    process.env.BILLING_ENCRYPTION_KEY =
      process.env.BILLING_ENCRYPTION_KEY ??
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    result = await createIntegrationApp({ modules: [AppModule] });
    reseller = await createTestReseller(result.db);
    token = createResellerToken({
      sub: reseller.userId,
      resellerId: reseller.resellerId,
      membershipId: reseller.membershipId,
      roleId: reseller.roleId,
    });
    planId = await asAdmin(async (tx) => {
      const [plan] = await tx
        .insert(plans)
        .values({
          resellerId: reseller.resellerId,
          name: { en: 'Basic' },
          code: `basic-${randomUUID().slice(0, 8)}`,
          status: 'ACTIVE',
          interval: 'MONTHLY',
          amount: 99_900n,
          ...BY,
        })
        .returning({ id: plans.id });
      return plan.id;
    });
  });

  afterAll(async () => {
    await result?.close();
  });

  it('should refuse generateInvoice for the period that assigning the plan already billed', async () => {
    const institute = await newInstitute();
    const assigned = await gqlRequest<{
      assignPlanToInstitute: { subscription: { id: string } };
    }>(result.httpServer, {
      query: ASSIGN,
      variables: { tenantId: institute.tenantId, planId },
      token,
    });
    expect(assigned.errors).toBeUndefined();
    const subscriptionId = assigned.data?.assignPlanToInstitute.subscription.id ?? '';
    expect(await invoicesOf(subscriptionId)).toHaveLength(1);

    const again = await generate(institute.tenantId, subscriptionId);

    expect(again.errors?.[0]?.extensions?.code).toBe(ErrorCode.INVOICE_PERIOD_ALREADY_BILLED);
    expect(await invoicesOf(subscriptionId)).toHaveLength(1);
  });

  it('should bill a period once, and again after that invoice is cancelled', async () => {
    const institute = await newInstitute();
    const subscription = await addSubscription(institute.tenantId);

    const first = await generate(institute.tenantId, subscription.id);
    expect(first.errors).toBeUndefined();
    const second = await generate(institute.tenantId, subscription.id);
    expect(second.errors?.[0]?.extensions?.code).toBe(ErrorCode.INVOICE_PERIOD_ALREADY_BILLED);
    expect(await invoicesOf(subscription.id)).toHaveLength(1);

    await asAdmin((tx) =>
      tx
        .update(invoices)
        .set({ status: 'CANCELLED' })
        .where(eq(invoices.id, first.data?.generateInvoice.id ?? '')),
    );
    const third = await generate(institute.tenantId, subscription.id);

    expect(third.errors).toBeUndefined();
    expect((await invoicesOf(subscription.id)).map((row) => row.status)).toEqual([
      'CANCELLED',
      'SENT',
    ]);
  });

  it('should bill the next period of the same subscription', async () => {
    const institute = await newInstitute();
    const subscription = await addSubscription(institute.tenantId);
    expect((await generate(institute.tenantId, subscription.id)).errors).toBeUndefined();

    await asAdmin((tx) =>
      tx
        .update(subscriptions)
        .set({
          currentPeriodStart: new Date(Date.now() + 25 * DAY),
          currentPeriodEnd: new Date(Date.now() + 55 * DAY),
        })
        .where(eq(subscriptions.id, subscription.id)),
    );

    expect((await generate(institute.tenantId, subscription.id)).errors).toBeUndefined();
    expect(await invoicesOf(subscription.id)).toHaveLength(2);
  });

  describe('in PostgreSQL', () => {
    const duplicateOf = async () => {
      const institute = await newInstitute();
      const subscription = await addSubscription(institute.tenantId);
      const row = {
        tenantId: institute.tenantId,
        subscriptionId: subscription.id,
        resellerId: reseller.resellerId,
        status: 'SENT' as const,
        periodStart: subscription.periodStart,
        dueAt: new Date(Date.now() + 15 * DAY),
        ...BY,
      };
      await asAdmin((tx) =>
        tx.insert(invoices).values({ ...row, invoiceNumber: `T-${randomUUID().slice(0, 12)}` }),
      );
      return { ...row, invoiceNumber: `T-${randomUUID().slice(0, 12)}` };
    };

    it('should refuse the second row for the reseller role', async () => {
      const duplicate = await duplicateOf();
      await expect(
        withReseller(result.db, mkResellerCtx(reseller.resellerId, ORIGIN), (tx) =>
          tx.insert(invoices).values(duplicate),
        ),
      ).rejects.toMatchObject({
        cause: { code: '23505', constraint: 'invoices_subscription_period_key' },
      });
    });

    it('should refuse the second row for the platform role', async () => {
      const duplicate = await duplicateOf();
      await expect(asAdmin((tx) => tx.insert(invoices).values(duplicate))).rejects.toMatchObject({
        cause: { code: '23505', constraint: 'invoices_subscription_period_key' },
      });
    });

    it('should accept a second row when the first is cancelled or refunded', async () => {
      for (const status of ['CANCELLED', 'REFUNDED'] as const) {
        const duplicate = await duplicateOf();
        await asAdmin((tx) =>
          tx
            .update(invoices)
            .set({ status })
            .where(eq(invoices.subscriptionId, duplicate.subscriptionId)),
        );
        await asAdmin((tx) => tx.insert(invoices).values(duplicate));
        expect(await invoicesOf(duplicate.subscriptionId)).toHaveLength(2);
      }
    });
  });
});
