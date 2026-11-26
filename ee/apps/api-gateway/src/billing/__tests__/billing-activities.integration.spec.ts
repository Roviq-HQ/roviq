/**
 * The billing workflow activities against real PostgreSQL. Each test runs inside an admin
 * transaction that is rolled back at the end: the sweeping activities (renewals, grace period,
 * trials, overdue invoices, UPI expiry) match rows of every institute, and must not leave
 * changes on rows other spec files created.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import {
  createDrizzleDb,
  type DrizzleDB,
  mkAdminCtx,
  ROVIQ_DIRECT_RESELLER_ID,
  SYSTEM_USER_ID,
  withAdmin,
} from '@roviq/database';
import { gatewayConfigs, invoices, payments, plans, subscriptions } from '@roviq/ee-database';
import {
  createTestInstitute,
  createTestReseller,
  type TestInstitute,
  type TestReseller,
} from '@roviq/testing/integration';
import { eq, inArray } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBillingActivities } from '../workflows/billing.activities';

const hasTestDb = !!process.env.DATABASE_URL_TEST;
const ORIGIN = 'test:billing-activities';
const DAY = 86_400_000;

class RolledBack extends Error {}

describe.skipIf(!hasTestDb)('Billing workflow activities (integration)', () => {
  let pool: Pool;
  let db: DrizzleDB;
  let reseller: TestReseller;
  let otherReseller: TestReseller;
  let first: TestInstitute;
  let second: TestInstitute;
  let otherInstitute: TestInstitute;
  /** Fixture rows are written by a real user, so a SYSTEM_USER_ID afterwards proves the activity. */
  let by: { createdBy: string; updatedBy: string };

  /** Runs `fn` in an admin transaction and rolls everything it wrote back. */
  async function rolledBack(fn: (tx: DrizzleDB) => Promise<void>): Promise<void> {
    let finished = false;
    await withAdmin(db, mkAdminCtx(ORIGIN), async (tx) => {
      await fn(tx);
      finished = true;
      throw new RolledBack();
    }).catch((err: unknown) => {
      if (!(err instanceof RolledBack)) throw err;
    });
    expect(finished).toBe(true);
  }

  async function addPlan(tx: DrizzleDB, resellerId: string, deletedAt: Date | null = null) {
    const [plan] = await tx
      .insert(plans)
      .values({
        resellerId,
        name: { en: 'Activities plan' },
        code: `act-${randomUUID().slice(0, 8)}`,
        interval: 'MONTHLY',
        amount: 99_900n,
        deletedAt,
        ...by,
      })
      .returning();
    return plan;
  }

  async function addSubscription(
    tx: DrizzleDB,
    values: Pick<typeof subscriptions.$inferInsert, 'tenantId' | 'resellerId' | 'planId'> &
      Partial<typeof subscriptions.$inferInsert>,
  ) {
    const [subscription] = await tx
      .insert(subscriptions)
      .values({
        currentPeriodStart: new Date(Date.now() - 5 * DAY),
        currentPeriodEnd: new Date(Date.now() + 25 * DAY),
        ...by,
        ...values,
      })
      .returning();
    return subscription;
  }

  async function addInvoice(
    tx: DrizzleDB,
    values: Pick<
      typeof invoices.$inferInsert,
      'tenantId' | 'subscriptionId' | 'resellerId' | 'status' | 'dueAt'
    > &
      Partial<typeof invoices.$inferInsert>,
  ) {
    const [invoice] = await tx
      .insert(invoices)
      .values({
        invoiceNumber: `INV-${randomUUID().slice(0, 12)}`,
        subtotalAmount: 99_900n,
        taxAmount: 17_982n,
        totalAmount: 117_882n,
        paidAmount: 0n,
        issuedAt: new Date(),
        ...by,
        ...values,
      })
      .returning();
    return invoice;
  }

  async function addGatewayConfig(tx: DrizzleDB, resellerId: string) {
    const [config] = await tx
      .insert(gatewayConfigs)
      .values({
        resellerId,
        provider: 'RAZORPAY',
        displayName: 'Razorpay',
        credentials: { RAZORPAY_KEY_ID: 'never-used' },
        ...by,
      })
      .returning();
    return config;
  }

  beforeAll(async () => {
    assert(process.env.DATABASE_URL_TEST);
    pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST, max: 5 });
    db = createDrizzleDb(pool);
    reseller = await createTestReseller(db);
    otherReseller = await createTestReseller(db);
    first = await createTestInstitute(db, { resellerId: reseller.resellerId });
    second = await createTestInstitute(db, { resellerId: reseller.resellerId });
    otherInstitute = await createTestInstitute(db, { resellerId: otherReseller.resellerId });
    by = { createdBy: reseller.userId, updatedBy: reseller.userId };
  });

  afterAll(async () => {
    await pool?.end();
  });

  describe('cleanupResellerDeletion', () => {
    it('should move every subscription to Roviq Direct and deactivate plans and gateway configs', async () => {
      await rolledBack(async (tx) => {
        const plan = await addPlan(tx, reseller.resellerId);
        const deletedPlan = await addPlan(tx, reseller.resellerId, new Date());
        const config = await addGatewayConfig(tx, reseller.resellerId);
        const active = await addSubscription(tx, {
          tenantId: first.tenantId,
          resellerId: reseller.resellerId,
          planId: plan.id,
        });
        const cancelled = await addSubscription(tx, {
          tenantId: second.tenantId,
          resellerId: reseller.resellerId,
          planId: plan.id,
          status: 'CANCELLED',
          cancelledAt: new Date(),
        });
        const invoice = await addInvoice(tx, {
          tenantId: first.tenantId,
          subscriptionId: active.id,
          resellerId: reseller.resellerId,
          status: 'PAID',
          dueAt: new Date(Date.now() + 15 * DAY),
        });
        const [payment] = await tx
          .insert(payments)
          .values({
            invoiceId: invoice.id,
            tenantId: first.tenantId,
            resellerId: reseller.resellerId,
            status: 'SUCCEEDED',
            method: 'CASH',
            amountPaise: 117_882n,
            paidAt: new Date(),
            ...by,
          })
          .returning();

        const result = await createBillingActivities(tx).cleanupResellerDeletion(
          reseller.resellerId,
        );

        expect(result).toEqual({
          subscriptionsTransferred: 2,
          plansDeactivated: 1,
          configsDeactivated: 1,
        });
        const subs = await tx
          .select({
            id: subscriptions.id,
            resellerId: subscriptions.resellerId,
            planId: subscriptions.planId,
            status: subscriptions.status,
            updatedBy: subscriptions.updatedBy,
          })
          .from(subscriptions)
          .where(inArray(subscriptions.id, [active.id, cancelled.id]))
          .orderBy(subscriptions.id);
        // The owner's rule: a moved subscription keeps its plan and price.
        expect(subs).toEqual(
          [
            {
              id: active.id,
              resellerId: ROVIQ_DIRECT_RESELLER_ID,
              planId: plan.id,
              status: 'ACTIVE',
              updatedBy: SYSTEM_USER_ID,
            },
            {
              id: cancelled.id,
              resellerId: ROVIQ_DIRECT_RESELLER_ID,
              planId: plan.id,
              status: 'CANCELLED',
              updatedBy: SYSTEM_USER_ID,
            },
          ].sort((a, b) => a.id.localeCompare(b.id)),
        );
        const planRows = await tx
          .select({ id: plans.id, status: plans.status, updatedBy: plans.updatedBy })
          .from(plans) // allow-base-read: the soft-deleted plan must stay untouched
          .where(inArray(plans.id, [plan.id, deletedPlan.id]));
        expect(planRows.find((p) => p.id === plan.id)).toEqual({
          id: plan.id,
          status: 'INACTIVE',
          updatedBy: SYSTEM_USER_ID,
        });
        expect(planRows.find((p) => p.id === deletedPlan.id)).toEqual({
          id: deletedPlan.id,
          status: 'ACTIVE',
          updatedBy: reseller.userId,
        });
        const [configRow] = await tx
          .select({ status: gatewayConfigs.status, updatedBy: gatewayConfigs.updatedBy })
          .from(gatewayConfigs)
          .where(eq(gatewayConfigs.id, config.id));
        expect(configRow).toEqual({ status: 'INACTIVE', updatedBy: SYSTEM_USER_ID });
        const [invoiceRow] = await tx
          .select({ resellerId: invoices.resellerId })
          .from(invoices)
          .where(eq(invoices.id, invoice.id));
        expect(invoiceRow.resellerId).toBe(reseller.resellerId);
        const [paymentRow] = await tx
          .select({ resellerId: payments.resellerId })
          .from(payments)
          .where(eq(payments.id, payment.id));
        expect(paymentRow.resellerId).toBe(reseller.resellerId);
      });
    });

    it('should leave another reseller’s subscription, plan and gateway config untouched', async () => {
      await rolledBack(async (tx) => {
        await addPlan(tx, reseller.resellerId);
        const otherPlan = await addPlan(tx, otherReseller.resellerId);
        const otherConfig = await addGatewayConfig(tx, otherReseller.resellerId);
        const otherSub = await addSubscription(tx, {
          tenantId: otherInstitute.tenantId,
          resellerId: otherReseller.resellerId,
          planId: otherPlan.id,
        });

        await createBillingActivities(tx).cleanupResellerDeletion(reseller.resellerId);

        const [sub] = await tx
          .select({ resellerId: subscriptions.resellerId, updatedBy: subscriptions.updatedBy })
          .from(subscriptions)
          .where(eq(subscriptions.id, otherSub.id));
        expect(sub).toEqual({ resellerId: otherReseller.resellerId, updatedBy: reseller.userId });
        const [planRow] = await tx
          .select({ status: plans.status })
          .from(plans)
          .where(eq(plans.id, otherPlan.id));
        expect(planRow.status).toBe('ACTIVE');
        const [configRow] = await tx
          .select({ status: gatewayConfigs.status })
          .from(gatewayConfigs)
          .where(eq(gatewayConfigs.id, otherConfig.id));
        expect(configRow.status).toBe('ACTIVE');
      });
    });

    it('should complete with zero counts for a reseller with no billing rows, and on a second run', async () => {
      await rolledBack(async (tx) => {
        const activities = createBillingActivities(tx);
        const zero = { subscriptionsTransferred: 0, plansDeactivated: 0, configsDeactivated: 0 };

        expect(await activities.cleanupResellerDeletion(reseller.resellerId)).toEqual(zero);

        const plan = await addPlan(tx, reseller.resellerId);
        await addGatewayConfig(tx, reseller.resellerId);
        await addSubscription(tx, {
          tenantId: first.tenantId,
          resellerId: reseller.resellerId,
          planId: plan.id,
        });
        expect(await activities.cleanupResellerDeletion(reseller.resellerId)).toEqual({
          subscriptionsTransferred: 1,
          plansDeactivated: 1,
          configsDeactivated: 1,
        });
        expect(await activities.cleanupResellerDeletion(reseller.resellerId)).toEqual(zero);
      });
    });
  });

  describe('the sweeping activities write SYSTEM_USER_ID', () => {
    it('should generate a renewal invoice created and updated by the system user', async () => {
      await rolledBack(async (tx) => {
        const plan = await addPlan(tx, reseller.resellerId);
        const sub = await addSubscription(tx, {
          tenantId: first.tenantId,
          resellerId: reseller.resellerId,
          planId: plan.id,
          currentPeriodEnd: new Date(Date.now() + 2 * DAY),
        });

        await createBillingActivities(tx).processRenewals();

        const rows = await tx
          .select({ createdBy: invoices.createdBy, updatedBy: invoices.updatedBy })
          .from(invoices)
          .where(eq(invoices.subscriptionId, sub.id));
        expect(rows).toEqual([{ createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID }]);
      });
    });

    it('should cancel a subscription past its grace period as the system user', async () => {
      await rolledBack(async (tx) => {
        const plan = await addPlan(tx, reseller.resellerId);
        const sub = await addSubscription(tx, {
          tenantId: first.tenantId,
          resellerId: reseller.resellerId,
          planId: plan.id,
          status: 'PAST_DUE',
          updatedAt: new Date(Date.now() - 8 * DAY),
        });

        await createBillingActivities(tx).cancelGracePeriodExpired();

        const [row] = await tx
          .select({ status: subscriptions.status, updatedBy: subscriptions.updatedBy })
          .from(subscriptions)
          .where(eq(subscriptions.id, sub.id));
        expect(row).toEqual({ status: 'CANCELLED', updatedBy: SYSTEM_USER_ID });
      });
    });

    it('should expire a finished trial as the system user', async () => {
      await rolledBack(async (tx) => {
        const plan = await addPlan(tx, reseller.resellerId);
        const sub = await addSubscription(tx, {
          tenantId: first.tenantId,
          resellerId: reseller.resellerId,
          planId: plan.id,
          status: 'TRIALING',
          trialEndsAt: new Date(Date.now() - DAY),
        });

        await createBillingActivities(tx).processTrialExpiry();

        const [row] = await tx
          .select({ status: subscriptions.status, updatedBy: subscriptions.updatedBy })
          .from(subscriptions)
          .where(eq(subscriptions.id, sub.id));
        expect(row).toEqual({ status: 'EXPIRED', updatedBy: SYSTEM_USER_ID });
      });
    });

    it('should mark a sent invoice past its due date overdue as the system user', async () => {
      await rolledBack(async (tx) => {
        const plan = await addPlan(tx, reseller.resellerId);
        const sub = await addSubscription(tx, {
          tenantId: first.tenantId,
          resellerId: reseller.resellerId,
          planId: plan.id,
        });
        const invoice = await addInvoice(tx, {
          tenantId: first.tenantId,
          subscriptionId: sub.id,
          resellerId: reseller.resellerId,
          status: 'SENT',
          dueAt: new Date(Date.now() - DAY),
        });

        await createBillingActivities(tx).markOverdueInvoices();

        const [row] = await tx
          .select({ status: invoices.status, updatedBy: invoices.updatedBy })
          .from(invoices)
          .where(eq(invoices.id, invoice.id));
        expect(row).toEqual({ status: 'OVERDUE', updatedBy: SYSTEM_USER_ID });
      });
    });

    it('should reverse an expired UPI verification as the system user', async () => {
      await rolledBack(async (tx) => {
        const plan = await addPlan(tx, reseller.resellerId);
        const sub = await addSubscription(tx, {
          tenantId: first.tenantId,
          resellerId: reseller.resellerId,
          planId: plan.id,
        });
        const invoice = await addInvoice(tx, {
          tenantId: first.tenantId,
          subscriptionId: sub.id,
          resellerId: reseller.resellerId,
          status: 'PAID',
          paidAmount: 117_882n,
          dueAt: new Date(Date.now() + 15 * DAY),
        });
        const [payment] = await tx
          .insert(payments)
          .values({
            invoiceId: invoice.id,
            tenantId: first.tenantId,
            resellerId: reseller.resellerId,
            status: 'SUCCEEDED',
            method: 'UPI_P2P',
            amountPaise: 117_882n,
            utrNumber: `${Date.now()}`.slice(0, 12),
            verificationStatus: 'PENDING_VERIFICATION',
            verificationDeadline: new Date(Date.now() - 60_000),
            paidAt: new Date(),
            ...by,
          })
          .returning();

        await createBillingActivities(tx).expireUpiVerifications();

        const [paymentRow] = await tx
          .select({ status: payments.status, updatedBy: payments.updatedBy })
          .from(payments)
          .where(eq(payments.id, payment.id));
        expect(paymentRow).toEqual({ status: 'FAILED', updatedBy: SYSTEM_USER_ID });
        const [invoiceRow] = await tx
          .select({ status: invoices.status, updatedBy: invoices.updatedBy })
          .from(invoices)
          .where(eq(invoices.id, invoice.id));
        expect(invoiceRow).toEqual({ status: 'SENT', updatedBy: SYSTEM_USER_ID });
        const [subRow] = await tx
          .select({ status: subscriptions.status, updatedBy: subscriptions.updatedBy })
          .from(subscriptions)
          .where(eq(subscriptions.id, sub.id));
        expect(subRow).toEqual({ status: 'PAST_DUE', updatedBy: SYSTEM_USER_ID });
      });
    });
  });
});
