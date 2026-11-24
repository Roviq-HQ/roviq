/**
 * ROV-293: every reseller billing operation that takes an id refuses a plan, subscription,
 * invoice, payment, gateway config or institute of another reseller, and every institute
 * billing operation refuses an invoice of another institute. A refusal returns none of the
 * row, changes no billing row of either reseller, emits no event, reaches no payment gateway,
 * stores no file and starts no workflow.
 */
import { randomUUID } from 'node:crypto';
import { ErrorCode } from '@roviq/common-types';
import {
  type DrizzleDB,
  files,
  institutes,
  mkAdminCtx,
  SYSTEM_USER_ID,
  withAdmin,
} from '@roviq/database';
import {
  gatewayConfigs,
  invoices,
  payments,
  plans,
  resellerInvoiceSequences,
  subscriptions,
} from '@roviq/ee-database';
import { PaymentGatewayFactory } from '@roviq/ee-payments';
import { EventBusService } from '@roviq/event-bus';
import { FakeStorageClient, StorageClient } from '@roviq/storage';
import { TemporalClientService } from '@roviq/temporal';
import {
  createInstituteToken,
  createIntegrationApp,
  createResellerToken,
  createTestInstitute,
  createTestReseller,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
  type TestReseller,
} from '@roviq/testing/integration';
import { Connection } from '@temporalio/client';
import { asc, inArray, or } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app/app.module';

const ORIGIN = 'test:billing-foreign-id';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
const DAY = 86_400_000;

const PLAN = 'query ($id: ID!) { subscriptionPlan(id: $id) { id } }';
const UPDATE_PLAN = /* GraphQL */ `
  mutation ($id: ID!) {
    updateSubscriptionPlan(id: $id, input: { version: 1, sortOrder: 7 }) {
      id
    }
  }
`;
const planMutation = (operation: string) => `mutation ($id: ID!) { ${operation}(id: $id) { id } }`;
const DELETE_PLAN = 'mutation ($id: ID!) { deletePlan(id: $id) }';
const CHANGE_PLAN = /* GraphQL */ `
  mutation ($subscriptionId: ID!, $newPlanId: ID!) {
    changePlan(input: { subscriptionId: $subscriptionId, newPlanId: $newPlanId }) {
      id
      planId
    }
  }
`;
const PAUSE = /* GraphQL */ `
  mutation ($id: ID!) {
    pauseSubscription(input: { subscriptionId: $id, reason: "Summer break" }) {
      id
    }
  }
`;
const RESUME = 'mutation ($id: ID!) { resumeSubscription(subscriptionId: $id) { id } }';
const CANCEL = /* GraphQL */ `
  mutation ($id: ID!) {
    cancelSubscription(input: { subscriptionId: $id, reason: "Closing" }) {
      id
    }
  }
`;
const INVOICES = 'query ($instituteId: ID) { invoices(instituteId: $instituteId) { id } }';
const GENERATE_INVOICE = /* GraphQL */ `
  mutation ($tenantId: ID!, $subscriptionId: ID!) {
    generateInvoice(input: { tenantId: $tenantId, subscriptionId: $subscriptionId }) {
      id
      tenantId
    }
  }
`;
const MANUAL_PAYMENT = /* GraphQL */ `
  mutation ($id: ID!) {
    recordManualPayment(invoiceId: $id, input: { method: CASH, amountPaise: "1000" }) {
      id
    }
  }
`;
const REFUND = /* GraphQL */ `
  mutation ($id: ID!) {
    issueRefund(paymentId: $id, input: { amountPaise: "1000", reason: "Duplicate" }) {
      id
    }
  }
`;
const INVOICE_PAYMENTS = 'query ($id: ID!) { invoicePayments(invoiceId: $id) { id } }';
const VERIFY_UPI = 'mutation ($id: ID!) { verifyUpiPayment(paymentId: $id) { id } }';
const REJECT_UPI = /* GraphQL */ `
  mutation ($id: ID!) {
    rejectUpiPayment(input: { paymentId: $id, reason: "UTR not found in statement" }) {
      id
    }
  }
`;
const UPDATE_CONFIG = /* GraphQL */ `
  mutation ($id: ID!) {
    updateGatewayConfig(id: $id, input: { displayName: "Renamed" }) {
      id
    }
  }
`;
const DELETE_CONFIG = 'mutation ($id: ID!) { deleteGatewayConfig(id: $id) }';
const MY_INVOICE = 'query ($id: ID!) { myInvoice(id: $id) { id } }';
const INVOICE_PDF = 'query ($id: ID!) { generateInvoicePdf(invoiceId: $id) }';
const SUBMIT_UPI = /* GraphQL */ `
  mutation ($id: ID!, $utr: String!) {
    submitUpiProof(input: { invoiceId: $id, utrNumber: $utr }) {
      id
    }
  }
`;

interface ResellerBilling {
  /** ACTIVE plans; `planId` is the one every subscription is on. */
  planId: string;
  otherPlanId: string;
  inactivePlanId: string;
  sparePlanId: string;
  /** ACTIVE subscription of the first institute. */
  subscriptionId: string;
  /** ACTIVE subscription of the second institute. */
  otherSubscriptionId: string;
  /** PAUSED subscription of the third institute. */
  pausedSubscriptionId: string;
  /** SENT invoices of the first and second institute. */
  invoiceId: string;
  otherInvoiceId: string;
  /** SUCCEEDED cash payment on `invoiceId`. */
  paymentId: string;
  /** UPI payment on `invoiceId` awaiting verification. */
  upiPaymentId: string;
  gatewayConfigId: string;
}

describe('billing: another reseller or institute id (ROV-293)', () => {
  let result: IntegrationAppResult;
  let resellerA: TestReseller;
  let resellerB: TestReseller;
  /** Institutes of reseller A: the caller of the institute-scope operations, and two more. */
  let a: [TestInstitute, TestInstitute, TestInstitute];
  let b: [TestInstitute, TestInstitute, TestInstitute];
  let billsA: ResellerBilling;
  let billsB: ResellerBilling;
  let resellerToken: string;
  let instituteToken: string;
  const storage = new FakeStorageClient();
  const gatewayFactory = {
    create: async (): Promise<never> => {
      throw new Error('No payment gateway may be reached');
    },
  };

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  const setUpBilling = (reseller: TestReseller, [first, second, third]: TestInstitute[]) =>
    asAdmin(async (tx): Promise<ResellerBilling> => {
      const resellerId = reseller.resellerId;
      const addPlan = async (code: string, status: 'ACTIVE' | 'INACTIVE') => {
        const [plan] = await tx
          .insert(plans)
          .values({
            resellerId,
            name: { en: code },
            code: `${code}-${randomUUID().slice(0, 8)}`,
            status,
            interval: 'MONTHLY',
            amount: 99_900n,
            ...BY,
          })
          .returning({ id: plans.id });
        return plan.id;
      };
      const planId = await addPlan('basic', 'ACTIVE');
      const addSubscription = async (tenantId: string, status: 'ACTIVE' | 'PAUSED') => {
        const now = Date.now();
        const [subscription] = await tx
          .insert(subscriptions)
          .values({
            tenantId,
            resellerId,
            planId,
            status,
            currentPeriodStart: new Date(now - 5 * DAY),
            currentPeriodEnd: new Date(now + 25 * DAY),
            pausedAt: status === 'PAUSED' ? new Date(now) : null,
            ...BY,
          })
          .returning({ id: subscriptions.id });
        return subscription.id;
      };
      const addInvoice = async (tenantId: string, subscriptionId: string) => {
        const [invoice] = await tx
          .insert(invoices)
          .values({
            tenantId,
            subscriptionId,
            resellerId,
            invoiceNumber: `INV-${randomUUID().slice(0, 12)}`,
            status: 'SENT',
            subtotalAmount: 99_900n,
            taxAmount: 17_982n,
            totalAmount: 117_882n,
            paidAmount: 10_000n,
            issuedAt: new Date(),
            dueAt: new Date(Date.now() + 15 * DAY),
            ...BY,
          })
          .returning({ id: invoices.id });
        return invoice.id;
      };
      const subscriptionId = await addSubscription(first.tenantId, 'ACTIVE');
      const otherSubscriptionId = await addSubscription(second.tenantId, 'ACTIVE');
      const invoiceId = await addInvoice(first.tenantId, subscriptionId);
      const [payment, upiPayment] = await tx
        .insert(payments)
        .values([
          {
            invoiceId,
            tenantId: first.tenantId,
            resellerId,
            status: 'SUCCEEDED',
            method: 'CASH',
            amountPaise: 5_000n,
            paidAt: new Date(),
            ...BY,
          },
          {
            invoiceId,
            tenantId: first.tenantId,
            resellerId,
            status: 'SUCCEEDED',
            method: 'UPI_P2P',
            amountPaise: 5_000n,
            utrNumber: `${Date.now()}${Math.floor(Math.random() * 1e6)}`.slice(0, 16),
            verificationStatus: 'PENDING_VERIFICATION',
            verificationDeadline: new Date(Date.now() + DAY),
            paidAt: new Date(),
            ...BY,
          },
        ])
        .returning({ id: payments.id });
      const [config] = await tx
        .insert(gatewayConfigs)
        .values({
          resellerId,
          provider: 'RAZORPAY',
          displayName: 'Razorpay',
          credentials: { RAZORPAY_KEY_ID: 'never-decrypted-on-a-refusal' },
          ...BY,
        })
        .returning({ id: gatewayConfigs.id });
      return {
        planId,
        otherPlanId: await addPlan('premium', 'ACTIVE'),
        inactivePlanId: await addPlan('legacy', 'INACTIVE'),
        sparePlanId: await addPlan('spare', 'ACTIVE'),
        subscriptionId,
        otherSubscriptionId,
        pausedSubscriptionId: await addSubscription(third.tenantId, 'PAUSED'),
        invoiceId,
        otherInvoiceId: await addInvoice(second.tenantId, otherSubscriptionId),
        paymentId: payment.id,
        upiPaymentId: upiPayment.id,
        gatewayConfigId: config.id,
      };
    });

  /** Billing rows of both resellers and of their institutes, and both resellers' institutes. */
  const snapshot = () =>
    asAdmin(async (tx) => {
      const resellerIds = [resellerA.resellerId, resellerB.resellerId];
      const tenantIds = [...a, ...b].map((inst) => inst.tenantId);
      return {
        plans: await tx
          .select()
          .from(plans)
          .where(inArray(plans.resellerId, resellerIds))
          .orderBy(asc(plans.id)),
        subscriptions: await tx
          .select()
          .from(subscriptions)
          .where(
            or(
              inArray(subscriptions.resellerId, resellerIds),
              inArray(subscriptions.tenantId, tenantIds),
            ),
          )
          .orderBy(asc(subscriptions.id)),
        invoices: await tx
          .select()
          .from(invoices)
          .where(
            or(inArray(invoices.resellerId, resellerIds), inArray(invoices.tenantId, tenantIds)),
          )
          .orderBy(asc(invoices.id)),
        payments: await tx
          .select()
          .from(payments)
          .where(
            or(inArray(payments.resellerId, resellerIds), inArray(payments.tenantId, tenantIds)),
          )
          .orderBy(asc(payments.id)),
        gatewayConfigs: await tx
          .select()
          .from(gatewayConfigs)
          .where(inArray(gatewayConfigs.resellerId, resellerIds))
          .orderBy(asc(gatewayConfigs.id)),
        sequences: await tx
          .select()
          .from(resellerInvoiceSequences)
          .where(inArray(resellerInvoiceSequences.resellerId, resellerIds))
          .orderBy(
            asc(resellerInvoiceSequences.resellerId),
            asc(resellerInvoiceSequences.currentYear),
          ),
        institutes: await tx
          .select()
          .from(institutes)
          .where(inArray(institutes.id, tenantIds))
          .orderBy(asc(institutes.id)),
        files: await tx
          .select()
          .from(files)
          .where(
            or(
              inArray(files.resellerId, resellerIds),
              inArray(files.tenantId, tenantIds),
              inArray(files.uploadedBy, [resellerA.userId, resellerB.userId, a[0].userId]),
            ),
          )
          .orderBy(asc(files.id)),
      };
    });

  const call = <T>(token: string, source: string, variables: Record<string, unknown>) =>
    gqlRequest<T>(result.httpServer, { query: source, variables, token });

  const query = async <T>(
    source: string,
    variables: Record<string, unknown>,
    token = resellerToken,
  ) => {
    const res = await call<T>(token, source, variables);
    expect(res.errors).toBeUndefined();
    return res.data;
  };

  const refusesAndWritesNothing = async (
    source: string,
    variables: Record<string, unknown>,
    code: string,
    token = resellerToken,
    // A nullable field resolves to null under `data`; a non-null one nulls `data` itself.
    refusedData: Record<string, null> | null = null,
  ) => {
    const before = await snapshot();
    const emit = vi.spyOn(EventBusService.prototype, 'emit');
    const gateway = vi.spyOn(gatewayFactory, 'create');
    const put = vi.spyOn(storage, 'put');
    const connect = vi
      .spyOn(Connection, 'connect')
      .mockRejectedValue(new Error('Temporal must not be reached'));
    const startWorkflow = vi
      .spyOn(TemporalClientService.prototype, 'startWorkflow')
      .mockRejectedValue(new Error('No workflow may start'));

    const res = await call(token, source, variables);

    expect(res.errors?.[0]?.extensions?.code).toBe(code);
    expect(res.data).toEqual(refusedData);
    expect(await snapshot()).toEqual(before);
    expect(emit.mock.calls.map(([pattern]) => pattern)).toEqual([]);
    expect(gateway).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(startWorkflow).not.toHaveBeenCalled();
  };

  beforeAll(async () => {
    // BillingModule is imported only when EE is on, and its CryptoService needs the key.
    process.env.ROVIQ_EE = 'true';
    process.env.BILLING_ENCRYPTION_KEY =
      process.env.BILLING_ENCRYPTION_KEY ??
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    result = await createIntegrationApp({
      modules: [AppModule],
      overrides: [
        { provide: StorageClient, useValue: storage },
        { provide: PaymentGatewayFactory, useValue: gatewayFactory },
        {
          provide: 'JETSTREAM_CLIENT',
          useValue: {
            emit: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }),
            send: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }),
            connect: async () => undefined,
            close: async () => undefined,
          },
        },
      ],
    });
    resellerA = await createTestReseller(result.db);
    resellerB = await createTestReseller(result.db);
    const institutesOf = async (reseller: TestReseller) => {
      const make = () => createTestInstitute(result.db, { resellerId: reseller.resellerId });
      return [await make(), await make(), await make()] as [
        TestInstitute,
        TestInstitute,
        TestInstitute,
      ];
    };
    a = await institutesOf(resellerA);
    b = await institutesOf(resellerB);
    billsA = await setUpBilling(resellerA, a);
    billsB = await setUpBilling(resellerB, b);
    resellerToken = createResellerToken({
      sub: resellerA.userId,
      resellerId: resellerA.resellerId,
      membershipId: resellerA.membershipId,
      roleId: resellerA.roleId,
    });
    instituteToken = createInstituteToken({
      sub: a[0].userId,
      tenantId: a[0].tenantId,
      membershipId: a[0].membershipId,
      roleId: a[0].roleId,
      resellerId: resellerA.resellerId,
    });
  });

  afterAll(async () => {
    await result?.close();
  });

  describe('plans', () => {
    it('subscriptionPlan should read its own plan and refuse a plan of another reseller', async () => {
      expect(await query(PLAN, { id: billsA.planId })).toEqual({
        subscriptionPlan: { id: billsA.planId },
      });
      await refusesAndWritesNothing(PLAN, { id: billsB.planId }, ErrorCode.PLAN_NOT_FOUND);
    });

    it('updateSubscriptionPlan should refuse a plan of another reseller', async () => {
      await refusesAndWritesNothing(
        UPDATE_PLAN,
        { id: billsB.planId },
        ErrorCode.CONCURRENT_MODIFICATION,
      );
    });

    it.each([
      ['archivePlan', (bills: ResellerBilling) => bills.sparePlanId],
      ['restorePlan', (bills: ResellerBilling) => bills.inactivePlanId],
    ] as const)('%s should refuse a plan of another reseller', async (operation, plan) => {
      await refusesAndWritesNothing(
        planMutation(operation),
        { id: plan(billsB) },
        ErrorCode.PLAN_NOT_FOUND,
      );
    });

    it('deletePlan should refuse a plan of another reseller', async () => {
      await refusesAndWritesNothing(DELETE_PLAN, { id: billsB.sparePlanId }, ErrorCode.NOT_FOUND);
    });
  });

  describe('subscriptions', () => {
    it('changePlan should move its own subscription to its own plan', async () => {
      expect(
        await query(CHANGE_PLAN, {
          subscriptionId: billsA.otherSubscriptionId,
          newPlanId: billsA.otherPlanId,
        }),
      ).toEqual({
        changePlan: { id: billsA.otherSubscriptionId, planId: billsA.otherPlanId },
      });
    });

    it.each([
      [
        'subscriptionId',
        () => ({ subscriptionId: billsB.subscriptionId, newPlanId: billsA.otherPlanId }),
        ErrorCode.SUBSCRIPTION_NOT_FOUND,
      ],
      [
        'newPlanId',
        () => ({ subscriptionId: billsA.subscriptionId, newPlanId: billsB.otherPlanId }),
        ErrorCode.PLAN_NOT_FOUND,
      ],
    ] as const)('changePlan should refuse %s of another reseller', async (_field, variables, code) => {
      await refusesAndWritesNothing(CHANGE_PLAN, variables(), code);
    });

    it.each([
      ['pauseSubscription', PAUSE, (bills: ResellerBilling) => bills.subscriptionId],
      ['cancelSubscription', CANCEL, (bills: ResellerBilling) => bills.subscriptionId],
      ['resumeSubscription', RESUME, (bills: ResellerBilling) => bills.pausedSubscriptionId],
    ] as const)('%s should refuse a subscription of another reseller', async (_operation, source, subscription) => {
      await refusesAndWritesNothing(
        source,
        { id: subscription(billsB) },
        ErrorCode.SUBSCRIPTION_NOT_FOUND,
      );
    });
  });

  describe('invoices and payments', () => {
    it('invoices should list its own institute and nothing of an institute of another reseller', async () => {
      expect(await query(INVOICES, { instituteId: a[0].tenantId })).toEqual({
        invoices: [{ id: billsA.invoiceId }],
      });
      expect(await query(INVOICES, { instituteId: b[0].tenantId })).toEqual({ invoices: [] });
    });

    it('generateInvoice should bill its own institute for its own subscription', async () => {
      const data = await query<{ generateInvoice: { id: string; tenantId: string } }>(
        GENERATE_INVOICE,
        { tenantId: a[0].tenantId, subscriptionId: billsA.subscriptionId },
      );

      expect(data?.generateInvoice.tenantId).toBe(a[0].tenantId);
    });

    it.each([
      [
        'subscriptionId',
        () => ({ tenantId: a[0].tenantId, subscriptionId: billsB.subscriptionId }),
        ErrorCode.SUBSCRIPTION_NOT_FOUND,
      ],
      [
        'tenantId',
        () => ({ tenantId: b[0].tenantId, subscriptionId: billsA.subscriptionId }),
        ErrorCode.INSTITUTE_NOT_FOUND,
      ],
    ] as const)('generateInvoice should refuse %s of another reseller and bill nothing', async (_field, variables, code) => {
      await refusesAndWritesNothing(GENERATE_INVOICE, variables(), code);
    });

    it('recordManualPayment should refuse an invoice of another reseller', async () => {
      await refusesAndWritesNothing(
        MANUAL_PAYMENT,
        { id: billsB.invoiceId },
        ErrorCode.INVOICE_NOT_FOUND,
      );
    });

    it('issueRefund should refuse a payment of another reseller', async () => {
      await refusesAndWritesNothing(REFUND, { id: billsB.paymentId }, ErrorCode.PAYMENT_NOT_FOUND);
    });

    it('invoicePayments should list its own invoice and refuse an invoice of another reseller', async () => {
      const own = await query<{ invoicePayments: { id: string }[] }>(INVOICE_PAYMENTS, {
        id: billsA.invoiceId,
      });

      expect(own?.invoicePayments.map((row) => row.id).sort()).toEqual(
        [billsA.paymentId, billsA.upiPaymentId].sort(),
      );
      await refusesAndWritesNothing(
        INVOICE_PAYMENTS,
        { id: billsB.invoiceId },
        ErrorCode.INVOICE_NOT_FOUND,
      );
    });

    it.each([
      ['verifyUpiPayment', VERIFY_UPI],
      ['rejectUpiPayment', REJECT_UPI],
    ] as const)('%s should refuse a payment of another reseller', async (_operation, source) => {
      await refusesAndWritesNothing(
        source,
        { id: billsB.upiPaymentId },
        ErrorCode.PAYMENT_NOT_FOUND,
      );
    });
  });

  describe('gateway configs', () => {
    it('updateGatewayConfig should refuse a config of another reseller', async () => {
      await refusesAndWritesNothing(
        UPDATE_CONFIG,
        { id: billsB.gatewayConfigId },
        ErrorCode.GATEWAY_CONFIG_NOT_FOUND,
      );
    });

    it('deleteGatewayConfig should refuse a config of another reseller', async () => {
      await refusesAndWritesNothing(
        DELETE_CONFIG,
        { id: billsB.gatewayConfigId },
        ErrorCode.GATEWAY_CONFIG_NOT_FOUND,
      );
    });
  });

  describe('institute scope', () => {
    const invoiceCases = [
      ['an institute of another reseller', () => billsB.invoiceId],
      ['another institute of the same reseller', () => billsA.otherInvoiceId],
    ] as const;

    it('myInvoice should read its own invoice', async () => {
      expect(await query(MY_INVOICE, { id: billsA.invoiceId }, instituteToken)).toEqual({
        myInvoice: { id: billsA.invoiceId },
      });
    });

    it.each(invoiceCases)('myInvoice should refuse an invoice of %s', async (_label, invoice) => {
      await refusesAndWritesNothing(
        MY_INVOICE,
        { id: invoice() },
        ErrorCode.INVOICE_NOT_FOUND,
        instituteToken,
        { myInvoice: null },
      );
    });

    it.each(
      invoiceCases,
    )('generateInvoicePdf should refuse an invoice of %s', async (_label, invoice) => {
      await refusesAndWritesNothing(
        INVOICE_PDF,
        { id: invoice() },
        ErrorCode.INVOICE_NOT_FOUND,
        instituteToken,
      );
    });

    it.each(
      invoiceCases,
    )('submitUpiProof should refuse an invoice of %s', async (_label, invoice) => {
      await refusesAndWritesNothing(
        SUBMIT_UPI,
        { id: invoice(), utr: `${Date.now()}`.padEnd(14, '7') },
        ErrorCode.INVOICE_NOT_FOUND,
        instituteToken,
      );
    });
  });
});
