import assert from 'node:assert';
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SEED_IDS } from '../../shared/seed-fixtures';
import {
  loginAsInstituteAdmin,
  loginAsInstituteAdminSecondInstitute,
  loginAsPlatformAdmin,
  loginAsReseller,
} from './helpers/auth';
import { gql } from './helpers/gql-client';
import { subscribeOnce } from './helpers/ws-client';

/**
 * Billing GraphQL subscriptions over graphql-ws: each event reaches the institute it is
 * about and its reseller, and no other institute.
 *
 * The seed has one reseller, so "another reseller's event" is covered by the filter unit
 * test (billing-subscriptions.resolver.spec.ts), not here.
 */

const CREATE_PLAN = `mutation($input: CreatePlanInput!) { createSubscriptionPlan(input: $input) { id } }`;
const LIST_SUBS = `query { subscriptions(first: 100) { id status tenantId } }`;
const CANCEL_SUB = `mutation($input: CancelSubscriptionInput!) { cancelSubscription(input: $input) { id } }`;
const ASSIGN_PLAN = `mutation($input: AssignPlanInput!) { assignPlanToInstitute(input: $input) { subscription { id } } }`;
const PAUSE_SUB = `mutation($input: PauseSubscriptionInput!) { pauseSubscription(input: $input) { id status } }`;
const RESUME_SUB = `mutation($subscriptionId: ID!) { resumeSubscription(subscriptionId: $subscriptionId) { id status } }`;
const INVOICES_OF_INSTITUTE = `query($instituteId: ID) { invoices(instituteId: $instituteId, first: 100) { id totalAmount subscriptionId } }`;
const RECORD_MANUAL = `mutation($invoiceId: ID!, $input: ManualPaymentInput!) { recordManualPayment(invoiceId: $invoiceId, input: $input) { id status } }`;
const VERIFY_UPI = `mutation($paymentId: ID!) { verifyUpiPayment(paymentId: $paymentId) { id verificationStatus } }`;
const SUBMIT_UPI = `mutation($input: SubmitUpiProofInput!) { submitUpiProof(input: $input) { id } }`;

const INVOICE_EVENT = `invoiceId tenantId`;
const PAYMENT_EVENT = `paymentId invoiceId tenantId`;
const SUBSCRIPTION_EVENT = `subscriptionId tenantId`;

interface InvoiceEvent {
  invoiceId: string;
  tenantId: string;
}
interface PaymentEvent {
  paymentId: string;
  invoiceId: string;
  tenantId: string;
}
interface SubscriptionEvent {
  subscriptionId: string;
  tenantId: string;
}

// The server registers the iterator only after connection_init round-trips.
const warmUp = () => new Promise((resolve) => setTimeout(resolve, 200));

describe('Billing realtime E2E', () => {
  let resellerToken: string;
  let instituteToken: string;
  let otherInstituteToken: string;
  let subscriptionId: string;
  const tenant1 = SEED_IDS.INSTITUTE_1;

  async function ok<T>(query: string, variables: Record<string, unknown>, token: string) {
    const res = await gql<T>(query, variables, token);
    expect(res.errors).toBeUndefined();
    assert(res.data);
    return res.data;
  }

  /**
   * Gives institute 1 a fresh subscription on a new paid plan, which bills its first period,
   * and returns that invoice. A subscription has one live invoice per period, so every test
   * that needs a new invoice gets a new subscription; `subscriptionId` follows the latest.
   */
  async function newInvoice() {
    const subs = await ok<{ subscriptions: { id: string; status: string; tenantId: string }[] }>(
      LIST_SUBS,
      {},
      resellerToken,
    );
    const live = subs.subscriptions.find(
      (s) => s.tenantId === tenant1 && s.status !== 'CANCELLED' && s.status !== 'EXPIRED',
    );
    if (live) await ok(CANCEL_SUB, { input: { subscriptionId: live.id } }, resellerToken);

    const suffix = randomUUID().slice(0, 8);
    const plan = await ok<{ createSubscriptionPlan: { id: string } }>(
      CREATE_PLAN,
      {
        input: {
          name: { en: `Vitest Realtime Plan ${suffix}` },
          description: { en: 'Created by billing-realtime.api-e2e.spec.ts' },
          amount: '100000',
          currency: 'INR',
          interval: 'MONTHLY',
          entitlements: {
            maxStudents: 50,
            maxStaff: 5,
            maxStorageMb: 512,
            auditLogRetentionDays: 30,
            features: [],
          },
          code: `VRT-${suffix.toUpperCase()}`,
        },
      },
      resellerToken,
    );
    const assigned = await ok<{ assignPlanToInstitute: { subscription: { id: string } } }>(
      ASSIGN_PLAN,
      { input: { tenantId: tenant1, planId: plan.createSubscriptionPlan.id } },
      resellerToken,
    );
    subscriptionId = assigned.assignPlanToInstitute.subscription.id;
    const billed = await ok<{
      invoices: { id: string; totalAmount: string; subscriptionId: string }[];
    }>(INVOICES_OF_INSTITUTE, { instituteId: tenant1 }, resellerToken);
    const invoice = billed.invoices.find((row) => row.subscriptionId === subscriptionId);
    assert(invoice);
    return invoice;
  }

  beforeAll(async () => {
    resellerToken = (await loginAsReseller()).accessToken;
    instituteToken = (await loginAsInstituteAdmin()).accessToken;
    otherInstituteToken = (await loginAsInstituteAdminSecondInstitute()).accessToken;

    const subs = await ok<{ subscriptions: { id: string; status: string; tenantId: string }[] }>(
      LIST_SUBS,
      {},
      resellerToken,
    );
    const live = subs.subscriptions.find(
      (s) => s.tenantId === tenant1 && s.status !== 'CANCELLED' && s.status !== 'EXPIRED',
    );
    if (live) await ok(CANCEL_SUB, { input: { subscriptionId: live.id } }, resellerToken);

    const suffix = randomUUID().slice(0, 8);
    const plan = await ok<{ createSubscriptionPlan: { id: string } }>(
      CREATE_PLAN,
      {
        input: {
          name: { en: `Vitest Realtime Plan ${suffix}` },
          description: { en: 'Created by billing-realtime.api-e2e.spec.ts' },
          amount: '100000',
          currency: 'INR',
          interval: 'MONTHLY',
          entitlements: {
            maxStudents: 50,
            maxStaff: 5,
            maxStorageMb: 512,
            auditLogRetentionDays: 30,
            features: [],
          },
          code: `VRT-${suffix.toUpperCase()}`,
        },
      },
      resellerToken,
    );
    const assigned = await ok<{ assignPlanToInstitute: { subscription: { id: string } } }>(
      ASSIGN_PLAN,
      { input: { tenantId: tenant1, planId: plan.createSubscriptionPlan.id } },
      resellerToken,
    );
    subscriptionId = assigned.assignPlanToInstitute.subscription.id;
  });

  // Cancelling the earlier subscription makes BillingEventConsumer suspend the institute.
  afterAll(async () => {
    const { accessToken: adminToken } = await loginAsPlatformAdmin();
    const status = await gql<{ adminGetInstitute: { status: string } }>(
      `query($id: ID!) { adminGetInstitute(id: $id) { status } }`,
      { id: tenant1 },
      adminToken,
    );
    if (status.data?.adminGetInstitute?.status !== 'ACTIVE') {
      await gql(
        `mutation($id: ID!) { adminActivateInstitute(id: $id) { id } }`,
        { id: tenant1 },
        adminToken,
      );
    }
  });

  describe('invoice generated', () => {
    it('reaches the institute and its reseller with the invoice id', async () => {
      const instituteEvent = subscribeOnce<{ myInvoiceGenerated: InvoiceEvent }>(
        `subscription { myInvoiceGenerated { ${INVOICE_EVENT} } }`,
        {},
        instituteToken,
      );
      const resellerEvent = subscribeOnce<{ resellerInvoiceGenerated: InvoiceEvent }>(
        `subscription { resellerInvoiceGenerated { ${INVOICE_EVENT} } }`,
        {},
        resellerToken,
      );
      await warmUp();

      const invoice = await newInvoice();

      expect((await instituteEvent).myInvoiceGenerated).toEqual({
        invoiceId: invoice.id,
        tenantId: tenant1,
      });
      expect((await resellerEvent).resellerInvoiceGenerated).toEqual({
        invoiceId: invoice.id,
        tenantId: tenant1,
      });
    });

    it('does not reach another institute', async () => {
      const otherInstituteEvent = subscribeOnce<{ myInvoiceGenerated: InvoiceEvent }>(
        `subscription { myInvoiceGenerated { ${INVOICE_EVENT} } }`,
        {},
        otherInstituteToken,
        2_500,
      );
      await warmUp();

      await newInvoice();

      await expect(otherInstituteEvent).rejects.toThrow(/Subscription timeout/);
    });
  });

  describe('subscription changed', () => {
    it('reaches the institute and its reseller when the subscription is paused', async () => {
      const instituteEvent = subscribeOnce<{ mySubscriptionStatusChanged: SubscriptionEvent }>(
        `subscription { mySubscriptionStatusChanged { ${SUBSCRIPTION_EVENT} } }`,
        {},
        instituteToken,
      );
      const resellerEvent = subscribeOnce<{ resellerSubscriptionChanged: SubscriptionEvent }>(
        `subscription { resellerSubscriptionChanged { ${SUBSCRIPTION_EVENT} } }`,
        {},
        resellerToken,
      );
      await warmUp();

      await ok(PAUSE_SUB, { input: { subscriptionId } }, resellerToken);

      expect((await instituteEvent).mySubscriptionStatusChanged).toEqual({
        subscriptionId,
        tenantId: tenant1,
      });
      expect((await resellerEvent).resellerSubscriptionChanged).toEqual({
        subscriptionId,
        tenantId: tenant1,
      });
    });

    it('does not reach another institute when the subscription is resumed', async () => {
      const otherInstituteEvent = subscribeOnce<{
        mySubscriptionStatusChanged: SubscriptionEvent;
      }>(
        `subscription { mySubscriptionStatusChanged { ${SUBSCRIPTION_EVENT} } }`,
        {},
        otherInstituteToken,
        2_500,
      );
      await warmUp();

      await ok(RESUME_SUB, { subscriptionId }, resellerToken);

      await expect(otherInstituteEvent).rejects.toThrow(/Subscription timeout/);
    });
  });

  describe('payment', () => {
    it('reaches the institute and its reseller when a cash payment is recorded', async () => {
      const invoice = await newInvoice();
      const instituteEvent = subscribeOnce<{ myPaymentStatusChanged: PaymentEvent }>(
        `subscription { myPaymentStatusChanged { ${PAYMENT_EVENT} } }`,
        {},
        instituteToken,
      );
      const resellerEvent = subscribeOnce<{ resellerPaymentReceived: PaymentEvent }>(
        `subscription { resellerPaymentReceived { ${PAYMENT_EVENT} } }`,
        {},
        resellerToken,
      );
      await warmUp();

      await ok(
        RECORD_MANUAL,
        {
          invoiceId: invoice.id,
          input: {
            method: 'CASH',
            amountPaise: invoice.totalAmount,
            receiptNumber: `VRT-REC-${randomUUID().slice(0, 6)}`,
          },
        },
        resellerToken,
      );

      const received = (await resellerEvent).resellerPaymentReceived;
      expect(received.invoiceId).toBe(invoice.id);
      expect(received.tenantId).toBe(tenant1);
      expect((await instituteEvent).myPaymentStatusChanged).toEqual(received);
    });

    it('tells the reseller a UPI proof is waiting, and tells no other institute', async () => {
      const invoice = await newInvoice();
      const resellerEvent = subscribeOnce<{ resellerPaymentStatusChanged: PaymentEvent }>(
        `subscription { resellerPaymentStatusChanged { ${PAYMENT_EVENT} } }`,
        {},
        resellerToken,
      );
      const otherInstituteEvent = subscribeOnce<{ myPaymentStatusChanged: PaymentEvent }>(
        `subscription { myPaymentStatusChanged { ${PAYMENT_EVENT} } }`,
        {},
        otherInstituteToken,
        2_500,
      );
      await warmUp();

      const utrNumber = `${Date.now()}`.slice(-9) + String(randomInt(10_000, 99_999));
      const proof = await ok<{ submitUpiProof: { id: string } }>(
        SUBMIT_UPI,
        { input: { invoiceId: invoice.id, utrNumber } },
        instituteToken,
      );

      expect((await resellerEvent).resellerPaymentStatusChanged).toEqual({
        paymentId: proof.submitUpiProof.id,
        invoiceId: invoice.id,
        tenantId: tenant1,
      });
      await expect(otherInstituteEvent).rejects.toThrow(/Subscription timeout/);
    });

    it('tells the institute when the reseller verifies its UPI proof', async () => {
      const invoice = await newInvoice();
      const utrNumber = `${Date.now()}`.slice(-9) + String(randomInt(10_000, 99_999));
      const proof = await ok<{ submitUpiProof: { id: string } }>(
        SUBMIT_UPI,
        { input: { invoiceId: invoice.id, utrNumber } },
        instituteToken,
      );
      const instituteEvent = subscribeOnce<{ myPaymentStatusChanged: PaymentEvent }>(
        `subscription { myPaymentStatusChanged { ${PAYMENT_EVENT} } }`,
        {},
        instituteToken,
      );
      await warmUp();

      const verified = await ok<{ verifyUpiPayment: { id: string; verificationStatus: string } }>(
        VERIFY_UPI,
        { paymentId: proof.submitUpiProof.id },
        resellerToken,
      );

      expect(verified.verifyUpiPayment.verificationStatus).toBe('VERIFIED');
      expect((await instituteEvent).myPaymentStatusChanged).toEqual({
        paymentId: proof.submitUpiProof.id,
        invoiceId: invoice.id,
        tenantId: tenant1,
      });
    });
  });

  describe('scope', () => {
    it('refuses a reseller subscription opened with an institute token', async () => {
      await expect(
        subscribeOnce<{ resellerInvoiceGenerated: InvoiceEvent }>(
          `subscription { resellerInvoiceGenerated { ${INVOICE_EVENT} } }`,
          {},
          instituteToken,
        ),
      ).rejects.toMatchObject([{ extensions: { code: 'FORBIDDEN', statusCode: 403 } }]);
    });

    it('refuses an institute subscription opened with a reseller token', async () => {
      await expect(
        subscribeOnce<{ myInvoiceGenerated: InvoiceEvent }>(
          `subscription { myInvoiceGenerated { ${INVOICE_EVENT} } }`,
          {},
          resellerToken,
        ),
      ).rejects.toMatchObject([{ extensions: { code: 'FORBIDDEN', statusCode: 403 } }]);
    });
  });
});
