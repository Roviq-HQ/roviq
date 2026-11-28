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

/**
 * Institute-side billing over HTTP: invoice reads, UPI proof verify/reject, plan change,
 * refunds, invoice PDF, payment history. Reseller-side CRUD lives in billing.api-e2e.spec.ts.
 *
 * Not covered here: the happy path of `initiatePayment` (needs a live Razorpay or Cashfree
 * order) and a reseller that does not own the institute (the seed has one reseller only).
 * Cross-tenant checks use the second institute of the same reseller.
 */

interface InvoiceNode {
  id: string;
  invoiceNumber: string;
  tenantId: string;
  resellerId: string;
  status: string;
  totalAmount: number | string;
  paidAmount: number | string;
  upiPaymentUri: string | null;
}

interface PaymentNode {
  id: string;
  invoiceId: string;
  tenantId: string;
  status: string;
  method: string;
  amountPaise: number | string;
  utrNumber: string | null;
  verificationStatus: string | null;
  verifiedAt: string | null;
  verifiedById: string | null;
  failureReason: string | null;
  refundedAmountPaise: number | string | null;
}

interface InvoicePaymentNode extends PaymentNode {
  collectedById: string | null;
}

interface GatewayConfigNode {
  id: string;
  provider: string;
  isDefault: boolean;
}

const INVOICE_FIELDS = `id invoiceNumber tenantId resellerId status totalAmount paidAmount upiPaymentUri`;
const PAYMENT_FIELDS = `id invoiceId tenantId status method amountPaise utrNumber verificationStatus verifiedAt verifiedById failureReason refundedAmountPaise`;

const CREATE_PLAN = `mutation($input: CreatePlanInput!) { createSubscriptionPlan(input: $input) { id } }`;
const ARCHIVE_PLAN = `mutation($id: ID!) { archivePlan(id: $id) { id status } }`;
const LIST_SUBS = `query { subscriptions(first: 100) { id status tenantId planId } }`;
const CANCEL_SUB = `mutation($input: CancelSubscriptionInput!) { cancelSubscription(input: $input) { id } }`;
const ASSIGN_PLAN = `mutation($input: AssignPlanInput!) { assignPlanToInstitute(input: $input) { subscription { id planId status } } }`;
const CHANGE_PLAN = `mutation($input: ChangePlanInput!) { changePlan(input: $input) { id status planId tenantId } }`;
const INVOICES_OF_INSTITUTE = `query($instituteId: ID) { invoices(instituteId: $instituteId, first: 100) { ${INVOICE_FIELDS} subscriptionId } }`;
const GENERATE_INVOICE = `mutation($input: GenerateInvoiceInput!) { generateInvoice(input: $input) { ${INVOICE_FIELDS} } }`;
const RECORD_MANUAL = `mutation($invoiceId: ID!, $input: ManualPaymentInput!) { recordManualPayment(invoiceId: $invoiceId, input: $input) { ${INVOICE_FIELDS} } }`;
const ISSUE_REFUND = `mutation($paymentId: ID!, $input: RefundInput!) { issueRefund(paymentId: $paymentId, input: $input) { id } }`;
const ISSUE_REFUND_INVOICE = `mutation($paymentId: ID!, $input: RefundInput!) { issueRefund(paymentId: $paymentId, input: $input) { ${INVOICE_FIELDS} } }`;
const UNVERIFIED = `query { unverifiedPayments(first: 100) { ${PAYMENT_FIELDS} } }`;
const VERIFY_UPI = `mutation($paymentId: ID!) { verifyUpiPayment(paymentId: $paymentId) { ${PAYMENT_FIELDS} } }`;
const REJECT_UPI = `mutation($input: RejectUpiInput!) { rejectUpiPayment(input: $input) { ${PAYMENT_FIELDS} } }`;
const CREATE_GATEWAY = `mutation($input: CreateGatewayConfigInput!) { createGatewayConfig(input: $input) { id provider upiVpa } }`;
const INVOICE_PAYMENTS = `query($invoiceId: ID!) { invoicePayments(invoiceId: $invoiceId) { ${PAYMENT_FIELDS} collectedById } }`;
const LIST_GATEWAYS = `query { gatewayConfigs { id provider isDefault } }`;
const UPDATE_GATEWAY = `mutation($id: ID!, $input: UpdateGatewayConfigInput!) { updateGatewayConfig(id: $id, input: $input) { id isDefault } }`;
const DELETE_GATEWAY = `mutation($id: ID!) { deleteGatewayConfig(id: $id) }`;

const MY_INVOICES = `query($first: Int) { myInvoices(first: $first) { ${INVOICE_FIELDS} } }`;
const MY_INVOICE = `query($id: ID!) { myInvoice(id: $id) { ${INVOICE_FIELDS} } }`;
const SUBMIT_UPI = `mutation($input: SubmitUpiProofInput!) { submitUpiProof(input: $input) { ${PAYMENT_FIELDS} } }`;
const MY_PAYMENTS = `query($first: Int) { myPaymentHistory(first: $first) { ${PAYMENT_FIELDS} } }`;
const INVOICE_PDF = `query($invoiceId: ID!) { generateInvoicePdf(invoiceId: $invoiceId) }`;
const INITIATE_PAYMENT = `mutation($invoiceId: ID!) { initiatePayment(invoiceId: $invoiceId) { paymentId } }`;

function codeOf(res: { errors?: readonly { extensions?: Record<string, unknown> }[] }) {
  return res.errors?.[0]?.extensions?.code;
}

/** 14 digits, unique per call; UTRs are unique per reseller. */
function newUtr() {
  return `${Date.now()}`.slice(-9) + String(randomInt(10_000, 99_999));
}

describe('Billing institute flows E2E', () => {
  let resellerToken: string;
  let instituteToken: string;
  let otherInstituteToken: string;
  const tenant1 = SEED_IDS.INSTITUTE_1;
  const tenant2 = SEED_IDS.INSTITUTE_2;
  const planAmountPaise = 100_000;
  const gatewayConfigIds: string[] = [];
  let defaultGatewayBefore: string | null = null;

  async function createPlan(amount: number, trialDays = 0) {
    const suffix = randomUUID().slice(0, 8);
    const res = await gql<{ createSubscriptionPlan: { id: string } }>(
      CREATE_PLAN,
      {
        input: {
          name: { en: `Vitest Inst Plan ${suffix}` },
          description: { en: 'Created by billing-institute.api-e2e.spec.ts' },
          amount: String(amount),
          trialDays,
          currency: 'INR',
          interval: 'MONTHLY',
          entitlements: {
            maxStudents: 50,
            maxStaff: 5,
            maxStorageMb: 512,
            auditLogRetentionDays: 30,
            features: [],
          },
          code: `VINST-${suffix.toUpperCase()}`,
        },
      },
      resellerToken,
    );
    expect(res.errors).toBeUndefined();
    assert(res.data);
    return res.data.createSubscriptionPlan.id;
  }

  async function cancelExistingSubscription(tenantId: string) {
    const res = await gql<{ subscriptions: { id: string; status: string; tenantId: string }[] }>(
      LIST_SUBS,
      undefined,
      resellerToken,
    );
    const live = res.data?.subscriptions.find(
      (s) => s.tenantId === tenantId && s.status !== 'CANCELLED' && s.status !== 'EXPIRED',
    );
    if (!live) return;
    await gql(CANCEL_SUB, { input: { subscriptionId: live.id } }, resellerToken);
  }

  /**
   * Replaces the institute's subscription with a fresh one on a new paid plan. Assigning a paid
   * plan bills its first period; with `trialDays` the subscription starts unbilled.
   */
  async function freshSubscription(tenantId: string, amount = planAmountPaise, trialDays = 0) {
    await cancelExistingSubscription(tenantId);
    const planId = await createPlan(amount, trialDays);
    const res = await gql<{
      assignPlanToInstitute: { subscription: { id: string; planId: string; status: string } };
    }>(ASSIGN_PLAN, { input: { tenantId, planId } }, resellerToken);
    expect(res.errors).toBeUndefined();
    assert(res.data);
    return { subscriptionId: res.data.assignPlanToInstitute.subscription.id, planId };
  }

  const handedOut = new Set<string>();

  /** The live invoice of the subscription's current period, when it has been billed. */
  async function billedInvoice(tenantId: string, subscriptionId: string) {
    const res = await gql<{ invoices: (InvoiceNode & { subscriptionId: string })[] }>(
      INVOICES_OF_INSTITUTE,
      { instituteId: tenantId },
      resellerToken,
    );
    expect(res.errors).toBeUndefined();
    return res.data?.invoices.find((invoice) => invoice.subscriptionId === subscriptionId);
  }

  /**
   * An invoice no test has used yet. A subscription has one live invoice per billing period:
   * the one its assignment created, or for an unbilled (trial) subscription the one
   * `generateInvoice` creates. A second invoice therefore comes from a fresh subscription.
   */
  async function newInvoice(tenantId: string, subscriptionId: string): Promise<InvoiceNode> {
    let invoice = await billedInvoice(tenantId, subscriptionId);
    if (!invoice) {
      const res = await gql<{ generateInvoice: InvoiceNode }>(
        GENERATE_INVOICE,
        { input: { tenantId, subscriptionId } },
        resellerToken,
      );
      expect(res.errors).toBeUndefined();
      assert(res.data);
      handedOut.add(res.data.generateInvoice.id);
      return res.data.generateInvoice;
    }
    if (handedOut.has(invoice.id)) {
      const fresh = await freshSubscription(tenantId);
      invoice = await billedInvoice(tenantId, fresh.subscriptionId);
    }
    assert(invoice);
    handedOut.add(invoice.id);
    return invoice;
  }

  async function myInvoice(id: string, token = instituteToken) {
    const res = await gql<{ myInvoice: InvoiceNode | null }>(MY_INVOICE, { id }, token);
    expect(res.errors).toBeUndefined();
    assert(res.data);
    return res.data.myInvoice;
  }

  async function submitProof(invoiceId: string, utrNumber = newUtr(), token = instituteToken) {
    return gql<{ submitUpiProof: PaymentNode }>(
      SUBMIT_UPI,
      { input: { invoiceId, utrNumber } },
      token,
    );
  }

  async function submitProofOk(invoiceId: string) {
    const res = await submitProof(invoiceId);
    expect(res.errors).toBeUndefined();
    assert(res.data);
    return res.data.submitUpiProof;
  }

  async function unverifiedIds() {
    const res = await gql<{ unverifiedPayments: PaymentNode[] }>(
      UNVERIFIED,
      undefined,
      resellerToken,
    );
    expect(res.errors).toBeUndefined();
    assert(res.data);
    return res.data.unverifiedPayments.map((p) => p.id);
  }

  async function paymentHistory(token = instituteToken) {
    const res = await gql<{ myPaymentHistory: PaymentNode[] }>(MY_PAYMENTS, { first: 100 }, token);
    expect(res.errors).toBeUndefined();
    assert(res.data);
    return res.data.myPaymentHistory;
  }

  beforeAll(async () => {
    resellerToken = (await loginAsReseller()).accessToken;
    instituteToken = (await loginAsInstituteAdmin()).accessToken;
    otherInstituteToken = (await loginAsInstituteAdminSecondInstitute()).accessToken;
  });

  // Cancelling subscriptions makes BillingEventConsumer suspend the institute; restore both.
  afterAll(async () => {
    for (const id of gatewayConfigIds) {
      await gql(DELETE_GATEWAY, { id }, resellerToken);
    }
    // Creating a default config clears the previous default; put it back.
    if (defaultGatewayBefore) {
      await gql(
        UPDATE_GATEWAY,
        { id: defaultGatewayBefore, input: { isDefault: true } },
        resellerToken,
      );
    }
    const { accessToken: adminToken } = await loginAsPlatformAdmin();
    for (const id of [tenant1, tenant2]) {
      const status = await gql<{ adminGetInstitute: { status: string } }>(
        `query($id: ID!) { adminGetInstitute(id: $id) { status } }`,
        { id },
        adminToken,
      );
      if (status.data?.adminGetInstitute?.status !== 'ACTIVE') {
        await gql(
          `mutation($id: ID!) { adminActivateInstitute(id: $id) { id } }`,
          { id },
          adminToken,
        );
      }
    }
  });

  // -------------------------------------------------------------------------
  // Institute reads its invoice
  // -------------------------------------------------------------------------

  describe('Invoice reads and UPI payment URI', () => {
    let invoice: InvoiceNode;

    beforeAll(async () => {
      const { subscriptionId } = await freshSubscription(tenant1);
      invoice = await newInvoice(tenant1, subscriptionId);
    });

    it('myInvoices lists the invoice the reseller generated', async () => {
      const res = await gql<{ myInvoices: InvoiceNode[] }>(
        MY_INVOICES,
        { first: 100 },
        instituteToken,
      );
      expect(res.errors).toBeUndefined();
      assert(res.data);
      const found = res.data.myInvoices.find((i) => i.id === invoice.id);
      assert(found);
      expect(found.tenantId).toBe(tenant1);
      expect(found.status).toBe('SENT');
      expect(Number(found.totalAmount)).toBe(Number(invoice.totalAmount));
      expect(res.data.myInvoices.every((i) => i.tenantId === tenant1)).toBe(true);
    });

    it('myInvoice returns the invoice with a null UPI URI while the reseller has no UPI config', async () => {
      const found = await myInvoice(invoice.id);
      assert(found);
      expect(found.id).toBe(invoice.id);
      expect(found.invoiceNumber).toBe(invoice.invoiceNumber);
      expect(found.resellerId).toBe(SEED_IDS.RESELLER_DIRECT);
      expect(found.upiPaymentUri).toBeNull();
    });

    it('myInvoice builds a upi://pay URI for the outstanding balance once a UPI_DIRECT config exists', async () => {
      const vpa = `vitest${randomUUID().slice(0, 6)}@upi`;
      const created = await gql<{ createGatewayConfig: { id: string; upiVpa: string | null } }>(
        CREATE_GATEWAY,
        {
          input: {
            provider: 'UPI_DIRECT',
            displayName: 'Vitest UPI',
            credentials: { VPA: vpa },
            isDefault: false,
            testMode: false,
            supportedMethods: ['upi'],
          },
        },
        resellerToken,
      );
      expect(created.errors).toBeUndefined();
      assert(created.data);
      gatewayConfigIds.push(created.data.createGatewayConfig.id);
      expect(created.data.createGatewayConfig.upiVpa).toBe(vpa);

      const found = await myInvoice(invoice.id);
      assert(found);
      assert(found.upiPaymentUri, 'upiPaymentUri is null although the reseller has a UPI config');
      expect(found.upiPaymentUri.startsWith('upi://pay?')).toBe(true);
      const params = new URLSearchParams(found.upiPaymentUri.slice('upi://pay?'.length));
      expect(params.get('pa')).toBe(vpa);
      expect(params.get('pn')).toBe('Roviq');
      expect(params.get('am')).toBe((Number(invoice.totalAmount) / 100).toFixed(2));
      expect(params.get('tn')).toBe(`INV-${invoice.invoiceNumber}`);
      expect(params.get('cu')).toBe('INR');
    });

    it('another institute neither lists nor reads the invoice', async () => {
      const list = await gql<{ myInvoices: InvoiceNode[] }>(
        MY_INVOICES,
        { first: 100 },
        otherInstituteToken,
      );
      expect(list.errors).toBeUndefined();
      assert(list.data);
      expect(list.data.myInvoices.some((i) => i.id === invoice.id)).toBe(false);
      // The same answer as an unknown id: the other institute cannot tell the invoice exists.
      const read = await gql<{ myInvoice: InvoiceNode | null }>(
        MY_INVOICE,
        { id: invoice.id },
        otherInstituteToken,
      );
      expect(codeOf(read)).toBe('INVOICE_NOT_FOUND');
      expect(read.data).toEqual({ myInvoice: null });
    });

    it('rejects an unknown invoice id with INVOICE_NOT_FOUND', async () => {
      const res = await gql(MY_INVOICE, { id: randomUUID() }, instituteToken);
      expect(codeOf(res)).toBe('INVOICE_NOT_FOUND');
    });

    it('rejects the reseller token on institute queries with FORBIDDEN', async () => {
      const res = await gql(MY_INVOICES, { first: 5 }, resellerToken);
      expect(codeOf(res)).toBe('FORBIDDEN');
    });
  });

  // -------------------------------------------------------------------------
  // UPI proof flow
  // -------------------------------------------------------------------------

  describe('UPI proof: verify', () => {
    let subscriptionId: string;

    beforeAll(async () => {
      ({ subscriptionId } = await freshSubscription(tenant1));
    });

    it('submit -> unverified list -> verify marks the payment verified and the invoice PAID', async () => {
      const invoice = await newInvoice(tenant1, subscriptionId);
      const utr = newUtr();

      const submitted = await submitProof(invoice.id, utr);
      expect(submitted.errors).toBeUndefined();
      assert(submitted.data);
      const payment = submitted.data.submitUpiProof;
      expect(payment.invoiceId).toBe(invoice.id);
      expect(payment.tenantId).toBe(tenant1);
      expect(payment.method).toBe('UPI_P2P');
      expect(payment.status).toBe('SUCCEEDED');
      expect(payment.utrNumber).toBe(utr);
      expect(payment.verificationStatus).toBe('PENDING_VERIFICATION');
      expect(Number(payment.amountPaise)).toBe(Number(invoice.totalAmount));

      expect(await unverifiedIds()).toContain(payment.id);

      const verified = await gql<{ verifyUpiPayment: PaymentNode }>(
        VERIFY_UPI,
        { paymentId: payment.id },
        resellerToken,
      );
      expect(verified.errors).toBeUndefined();
      assert(verified.data);
      expect(verified.data.verifyUpiPayment.id).toBe(payment.id);
      expect(verified.data.verifyUpiPayment.verificationStatus).toBe('VERIFIED');
      expect(verified.data.verifyUpiPayment.verifiedAt).not.toBeNull();
      expect(verified.data.verifyUpiPayment.verifiedById).toBeTruthy();

      expect(await unverifiedIds()).not.toContain(payment.id);

      const after = await myInvoice(invoice.id);
      assert(after);
      expect(after.status).toBe('PAID');
      expect(Number(after.paidAmount)).toBe(Number(invoice.totalAmount));
      expect(after.upiPaymentUri).toBeNull();
    });

    it('rejects verifying an already verified payment with INVOICE_NOT_PAYABLE', async () => {
      const invoice = await newInvoice(tenant1, subscriptionId);
      const payment = await submitProofOk(invoice.id);
      const first = await gql(VERIFY_UPI, { paymentId: payment.id }, resellerToken);
      expect(first.errors).toBeUndefined();

      const again = await gql(VERIFY_UPI, { paymentId: payment.id }, resellerToken);
      expect(codeOf(again)).toBe('INVOICE_NOT_PAYABLE');
    });

    it('rejects an unknown payment id with PAYMENT_NOT_FOUND', async () => {
      const res = await gql(VERIFY_UPI, { paymentId: randomUUID() }, resellerToken);
      expect(codeOf(res)).toBe('PAYMENT_NOT_FOUND');
    });

    it('rejects a malformed UTR with UTR_INVALID and a reused UTR with UTR_ALREADY_SUBMITTED', async () => {
      const invoice = await newInvoice(tenant1, subscriptionId);
      const bad = await submitProof(invoice.id, 'abcdefghijkl');
      expect(codeOf(bad)).toBe('UTR_INVALID');

      const utr = newUtr();
      const ok = await submitProof(invoice.id, utr);
      expect(ok.errors).toBeUndefined();
      const otherInvoice = await newInvoice(tenant1, subscriptionId);
      const dup = await submitProof(otherInvoice.id, utr);
      expect(codeOf(dup)).toBe('UTR_ALREADY_SUBMITTED');
    });

    it('rejects proof for an invoice that is already paid with INVOICE_NOT_PAYABLE', async () => {
      const invoice = await newInvoice(tenant1, subscriptionId);
      await submitProofOk(invoice.id);
      const second = await submitProof(invoice.id);
      expect(codeOf(second)).toBe('INVOICE_NOT_PAYABLE');
    });
  });

  describe('UPI proof: reject', () => {
    it('reject fails the payment and leaves the invoice payable again', async () => {
      const { subscriptionId } = await freshSubscription(tenant1);
      const invoice = await newInvoice(tenant1, subscriptionId);
      const payment = await submitProofOk(invoice.id);
      expect(await unverifiedIds()).toContain(payment.id);

      const rejected = await gql<{ rejectUpiPayment: PaymentNode }>(
        REJECT_UPI,
        { input: { paymentId: payment.id, reason: 'UTR not found in bank statement' } },
        resellerToken,
      );
      expect(rejected.errors).toBeUndefined();
      assert(rejected.data);
      expect(rejected.data.rejectUpiPayment.status).toBe('FAILED');
      expect(rejected.data.rejectUpiPayment.verificationStatus).toBe('REJECTED');
      expect(rejected.data.rejectUpiPayment.failureReason).toBe('UTR not found in bank statement');
      expect(await unverifiedIds()).not.toContain(payment.id);

      const after = await myInvoice(invoice.id);
      assert(after);
      expect(Number(after.paidAmount)).toBe(0);
      expect(after.status).toBe('SENT');

      // Payable again: a new proof is accepted.
      const retry = await submitProof(invoice.id);
      expect(retry.errors).toBeUndefined();

      const again = await gql(
        REJECT_UPI,
        { input: { paymentId: payment.id, reason: 'twice' } },
        resellerToken,
      );
      expect(codeOf(again)).toBe('INVOICE_NOT_PAYABLE');
    });
  });

  describe('UPI proof: cross-institute', () => {
    it("a second institute cannot submit proof for another institute's invoice", async () => {
      const { subscriptionId } = await freshSubscription(tenant1);
      const invoice = await newInvoice(tenant1, subscriptionId);

      const res = await submitProof(invoice.id, newUtr(), otherInstituteToken);
      expect(res.data).toBeNull();

      const after = await myInvoice(invoice.id);
      assert(after);
      expect(after.status).toBe('SENT');
      expect(Number(after.paidAmount)).toBe(0);
      expect(codeOf(res)).toBe('INVOICE_NOT_FOUND');
    });

    it('the reseller token cannot call the institute mutation', async () => {
      const res = await submitProof(randomUUID(), newUtr(), resellerToken);
      expect(codeOf(res)).toBe('FORBIDDEN');
    });

    it('the institute token cannot verify or reject payments', async () => {
      const verify = await gql(VERIFY_UPI, { paymentId: randomUUID() }, instituteToken);
      expect(codeOf(verify)).toBe('FORBIDDEN');
      const reject = await gql(
        REJECT_UPI,
        { input: { paymentId: randomUUID(), reason: 'x' } },
        instituteToken,
      );
      expect(codeOf(reject)).toBe('FORBIDDEN');
    });
  });

  // -------------------------------------------------------------------------
  // changePlan
  // -------------------------------------------------------------------------

  describe('changePlan', () => {
    it('moves the subscription to the new plan and bills the new plan amount', async () => {
      // On trial, so the period is not billed yet and the invoice below is its first.
      const { subscriptionId, planId } = await freshSubscription(tenant1, 100_000, 7);
      const newPlanId = await createPlan(250_000);

      const res = await gql<{
        changePlan: { id: string; status: string; planId: string; tenantId: string };
      }>(CHANGE_PLAN, { input: { subscriptionId, newPlanId } }, resellerToken);
      expect(res.errors).toBeUndefined();
      assert(res.data);
      expect(res.data.changePlan.id).toBe(subscriptionId);
      expect(res.data.changePlan.status).toBe('TRIALING');
      expect(res.data.changePlan.tenantId).toBe(tenant1);
      expect(res.data.changePlan.planId).toBe(newPlanId);
      expect(res.data.changePlan.planId).not.toBe(planId);

      const subs = await gql<{ subscriptions: { id: string; planId: string }[] }>(
        LIST_SUBS,
        undefined,
        resellerToken,
      );
      expect(subs.data?.subscriptions.find((s) => s.id === subscriptionId)?.planId).toBe(newPlanId);

      // 250000 paise + 18% GST
      const invoice = await newInvoice(tenant1, subscriptionId);
      expect(Number(invoice.totalAmount)).toBe(295_000);
    });

    it('rejects an archived target plan and an unknown subscription', async () => {
      const { subscriptionId } = await freshSubscription(tenant1);
      const archivedPlanId = await createPlan(50_000);
      const archived = await gql(ARCHIVE_PLAN, { id: archivedPlanId }, resellerToken);
      expect(archived.errors).toBeUndefined();

      const toArchived = await gql(
        CHANGE_PLAN,
        { input: { subscriptionId, newPlanId: archivedPlanId } },
        resellerToken,
      );
      expect(codeOf(toArchived)).toBe('PLAN_NOT_FOUND');

      const unknownSub = await gql(
        CHANGE_PLAN,
        { input: { subscriptionId: randomUUID(), newPlanId: await createPlan(50_000) } },
        resellerToken,
      );
      expect(codeOf(unknownSub)).toBe('SUBSCRIPTION_NOT_FOUND');
    });

    it('rejects changing the plan of a cancelled subscription with SUBSCRIPTION_TERMINAL', async () => {
      const { subscriptionId } = await freshSubscription(tenant2);
      const cancelled = await gql(CANCEL_SUB, { input: { subscriptionId } }, resellerToken);
      expect(cancelled.errors).toBeUndefined();

      const res = await gql(
        CHANGE_PLAN,
        { input: { subscriptionId, newPlanId: await createPlan(50_000) } },
        resellerToken,
      );
      expect(codeOf(res)).toBe('SUBSCRIPTION_TERMINAL');
    });
  });

  // -------------------------------------------------------------------------
  // Refund
  // -------------------------------------------------------------------------

  describe('issueRefund', () => {
    async function cashPaidInvoice() {
      const { subscriptionId } = await freshSubscription(tenant1);
      const invoice = await newInvoice(tenant1, subscriptionId);
      const total = Number(invoice.totalAmount);
      const paid = await gql<{ recordManualPayment: InvoiceNode }>(
        RECORD_MANUAL,
        {
          invoiceId: invoice.id,
          input: {
            method: 'CASH',
            amountPaise: String(total),
            receiptNumber: `VINST-REC-${randomUUID().slice(0, 6)}`,
          },
        },
        resellerToken,
      );
      expect(paid.errors).toBeUndefined();
      assert(paid.data);
      expect(paid.data.recordManualPayment.status).toBe('PAID');

      const payment = (await paymentHistory()).find((p) => p.invoiceId === invoice.id);
      assert(payment);
      expect(payment.status).toBe('SUCCEEDED');
      expect(payment.method).toBe('CASH');
      expect(Number(payment.amountPaise)).toBe(total);
      return { invoice, payment, total };
    }

    async function refundedPayment(paymentId: string) {
      return (await paymentHistory()).find((p) => p.id === paymentId);
    }

    it('a partial refund marks the payment PARTIALLY_REFUNDED and lowers the invoice paid amount', async () => {
      const { invoice, payment, total } = await cashPaidInvoice();
      const part = total / 4;

      const res = await gql(
        ISSUE_REFUND,
        { paymentId: payment.id, input: { amountPaise: String(part), reason: 'goodwill' } },
        resellerToken,
      );
      expect(res.errors).toBeUndefined();

      const afterPayment = await refundedPayment(payment.id);
      expect(afterPayment?.status).toBe('PARTIALLY_REFUNDED');
      expect(Number(afterPayment?.refundedAmountPaise)).toBe(part);
      const afterInvoice = await myInvoice(invoice.id);
      expect(afterInvoice?.status).toBe('PARTIALLY_PAID');
      expect(Number(afterInvoice?.paidAmount)).toBe(total - part);
    });

    it('a full refund marks the payment and the invoice REFUNDED; a second refund is INVOICE_NOT_PAYABLE', async () => {
      const { invoice, payment, total } = await cashPaidInvoice();

      const res = await gql(
        ISSUE_REFUND,
        { paymentId: payment.id, input: { amountPaise: String(total) } },
        resellerToken,
      );
      expect(res.errors).toBeUndefined();

      const afterPayment = await refundedPayment(payment.id);
      expect(afterPayment?.status).toBe('REFUNDED');
      expect(Number(afterPayment?.refundedAmountPaise)).toBe(total);
      const afterInvoice = await myInvoice(invoice.id);
      expect(afterInvoice?.status).toBe('REFUNDED');
      expect(Number(afterInvoice?.paidAmount)).toBe(0);

      const again = await gql(
        ISSUE_REFUND,
        { paymentId: payment.id, input: { amountPaise: '1' } },
        resellerToken,
      );
      expect(codeOf(again)).toBe('INVOICE_NOT_PAYABLE');
    });

    it('refunding more than was paid is REFUND_EXCEEDS_PAID and changes nothing', async () => {
      const { invoice, payment, total } = await cashPaidInvoice();

      const res = await gql(
        ISSUE_REFUND,
        { paymentId: payment.id, input: { amountPaise: String(total + 1) } },
        resellerToken,
      );
      expect(codeOf(res)).toBe('REFUND_EXCEEDS_PAID');

      expect((await refundedPayment(payment.id))?.status).toBe('SUCCEEDED');
      expect((await myInvoice(invoice.id))?.status).toBe('PAID');
    });

    it('refunds the rest of a partly refunded payment, and rejects more than the rest', async () => {
      const { invoice, payment, total } = await cashPaidInvoice();
      const part = total / 4;
      const first = await gql(
        ISSUE_REFUND,
        { paymentId: payment.id, input: { amountPaise: String(part) } },
        resellerToken,
      );
      expect(first.errors).toBeUndefined();

      const tooMuch = await gql(
        ISSUE_REFUND,
        { paymentId: payment.id, input: { amountPaise: String(total) } },
        resellerToken,
      );
      expect(codeOf(tooMuch)).toBe('REFUND_EXCEEDS_PAID');

      const rest = await gql(
        ISSUE_REFUND,
        { paymentId: payment.id, input: { amountPaise: String(total - part) } },
        resellerToken,
      );
      expect(rest.errors).toBeUndefined();
      expect((await refundedPayment(payment.id))?.status).toBe('REFUNDED');
      expect((await myInvoice(invoice.id))?.status).toBe('REFUNDED');
    });

    it('returns the refunded invoice, as the mutation schema declares', async () => {
      const { invoice, payment, total } = await cashPaidInvoice();

      const res = await gql<{ issueRefund: InvoiceNode }>(
        ISSUE_REFUND_INVOICE,
        { paymentId: payment.id, input: { amountPaise: String(total / 2) } },
        resellerToken,
      );
      expect(res.errors).toBeUndefined();
      assert(res.data);
      expect(res.data.issueRefund.id).toBe(invoice.id);
      expect(res.data.issueRefund.status).toBe('PARTIALLY_PAID');
      expect(Number(res.data.issueRefund.paidAmount)).toBe(total / 2);
    });
  });

  // -------------------------------------------------------------------------
  // Invoice PDF
  // -------------------------------------------------------------------------

  describe('generateInvoicePdf', () => {
    it('returns a base64 PDF for the own invoice and INVOICE_NOT_FOUND for an unknown one', async () => {
      const { subscriptionId } = await freshSubscription(tenant1);
      const invoice = await newInvoice(tenant1, subscriptionId);

      const res = await gql<{ generateInvoicePdf: string }>(
        INVOICE_PDF,
        { invoiceId: invoice.id },
        instituteToken,
      );
      expect(res.errors).toBeUndefined();
      assert(res.data);
      const bytes = Buffer.from(res.data.generateInvoicePdf, 'base64');
      expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(bytes.length).toBeGreaterThan(500);

      const unknown = await gql(INVOICE_PDF, { invoiceId: randomUUID() }, instituteToken);
      expect(codeOf(unknown)).toBe('INVOICE_NOT_FOUND');
    });
  });

  describe('generateInvoicePdf cross-institute', () => {
    it('answers INVOICE_NOT_FOUND for another institute invoice', async () => {
      const { subscriptionId } = await freshSubscription(tenant1);
      const invoice = await newInvoice(tenant1, subscriptionId);
      const other = await gql(INVOICE_PDF, { invoiceId: invoice.id }, otherInstituteToken);
      expect(other.data).toBeNull();
      expect(codeOf(other)).toBe('INVOICE_NOT_FOUND');
    });
  });

  // -------------------------------------------------------------------------
  // initiatePayment — guard paths that never reach a gateway
  // -------------------------------------------------------------------------

  describe('initiatePayment', () => {
    it('refuses another institute invoice and an already paid invoice before any gateway call', async () => {
      const { subscriptionId } = await freshSubscription(tenant1);
      const invoice = await newInvoice(tenant1, subscriptionId);

      const other = await gql(INITIATE_PAYMENT, { invoiceId: invoice.id }, otherInstituteToken);
      expect(codeOf(other)).toBe('INVOICE_NOT_FOUND');

      await submitProofOk(invoice.id);
      const paid = await gql(INITIATE_PAYMENT, { invoiceId: invoice.id }, instituteToken);
      expect(codeOf(paid)).toBe('INVOICE_ALREADY_PAID');
    });
  });

  // -------------------------------------------------------------------------
  // invoicePayments
  // -------------------------------------------------------------------------

  describe('invoicePayments', () => {
    it('lists the payments of an invoice for the reseller with the cash collector recorded', async () => {
      const { subscriptionId } = await freshSubscription(tenant1);
      const cashInvoice = await newInvoice(tenant1, subscriptionId);
      const cash = await gql(
        RECORD_MANUAL,
        {
          invoiceId: cashInvoice.id,
          input: { method: 'CASH', amountPaise: String(Number(cashInvoice.totalAmount)) },
        },
        resellerToken,
      );
      expect(cash.errors).toBeUndefined();
      const upiInvoice = await newInvoice(tenant1, subscriptionId);
      const proof = await submitProofOk(upiInvoice.id);

      const cashRes = await gql<{ invoicePayments: InvoicePaymentNode[] }>(
        INVOICE_PAYMENTS,
        { invoiceId: cashInvoice.id },
        resellerToken,
      );
      expect(cashRes.errors).toBeUndefined();
      assert(cashRes.data);
      expect(cashRes.data.invoicePayments).toHaveLength(1);
      const [cashPayment] = cashRes.data.invoicePayments;
      expect(cashPayment.invoiceId).toBe(cashInvoice.id);
      expect(cashPayment.method).toBe('CASH');
      expect(cashPayment.status).toBe('SUCCEEDED');
      assert(cashPayment.collectedById);

      const upiRes = await gql<{ invoicePayments: InvoicePaymentNode[] }>(
        INVOICE_PAYMENTS,
        { invoiceId: upiInvoice.id },
        resellerToken,
      );
      expect(upiRes.errors).toBeUndefined();
      assert(upiRes.data);
      expect(upiRes.data.invoicePayments.map((p) => p.id)).toEqual([proof.id]);
      expect(upiRes.data.invoicePayments[0].method).toBe('UPI_P2P');
      expect(upiRes.data.invoicePayments[0].collectedById).toBeNull();
    });

    it('answers INVOICE_NOT_FOUND for an unknown invoice id', async () => {
      const res = await gql(INVOICE_PAYMENTS, { invoiceId: randomUUID() }, resellerToken);
      expect(codeOf(res)).toBe('INVOICE_NOT_FOUND');
    });

    it('is refused for an institute token with FORBIDDEN', async () => {
      const { subscriptionId } = await freshSubscription(tenant1);
      const invoice = await newInvoice(tenant1, subscriptionId);
      const res = await gql(INVOICE_PAYMENTS, { invoiceId: invoice.id }, instituteToken);
      expect(codeOf(res)).toBe('FORBIDDEN');
    });
  });

  // -------------------------------------------------------------------------
  // Default gateway
  // -------------------------------------------------------------------------

  describe('gateway default', () => {
    async function listGateways() {
      const res = await gql<{ gatewayConfigs: GatewayConfigNode[] }>(
        LIST_GATEWAYS,
        undefined,
        resellerToken,
      );
      expect(res.errors).toBeUndefined();
      assert(res.data);
      return res.data.gatewayConfigs;
    }

    async function createGateway(provider: string, credentials: Record<string, string>) {
      const res = await gql<{ createGatewayConfig: { id: string } }>(
        CREATE_GATEWAY,
        {
          input: {
            provider,
            displayName: `Vitest ${provider}`,
            credentials,
            isDefault: true,
            testMode: provider !== 'UPI_DIRECT',
          },
        },
        resellerToken,
      );
      return res;
    }

    it('keeps exactly one default, moves it on create and update, and refuses UPI_DIRECT as default', async () => {
      defaultGatewayBefore = (await listGateways()).find((g) => g.isDefault)?.id ?? null;

      const a = await createGateway('RAZORPAY', {
        RAZORPAY_KEY_ID: 'rzp_test_a',
        RAZORPAY_KEY_SECRET: 'secret-a',
      });
      expect(a.errors).toBeUndefined();
      assert(a.data);
      const aId = a.data.createGatewayConfig.id;
      gatewayConfigIds.push(aId);

      const b = await createGateway('CASHFREE', {
        CASHFREE_APP_ID: 'cf_app_b',
        CASHFREE_SECRET_KEY: 'secret-b',
      });
      expect(b.errors).toBeUndefined();
      assert(b.data);
      const bId = b.data.createGatewayConfig.id;
      gatewayConfigIds.push(bId);

      const defaultsAfterB = (await listGateways()).filter((g) => g.isDefault);
      expect(defaultsAfterB.map((g) => g.id)).toEqual([bId]);

      const flip = await gql(
        UPDATE_GATEWAY,
        { id: aId, input: { isDefault: true } },
        resellerToken,
      );
      expect(flip.errors).toBeUndefined();
      const defaultsAfterA = (await listGateways()).filter((g) => g.isDefault);
      expect(defaultsAfterA.map((g) => g.id)).toEqual([aId]);

      const upi = await createGateway('UPI_DIRECT', { VPA: 'vitest@upi' });
      expect(codeOf(upi)).toBe('BAD_REQUEST');
      expect((await listGateways()).filter((g) => g.isDefault).map((g) => g.id)).toEqual([aId]);
    });
  });

  // -------------------------------------------------------------------------
  // myPaymentHistory
  // -------------------------------------------------------------------------

  describe('myPaymentHistory', () => {
    it('shows rejected, cash and pending-verification payments with their statuses, only for the own institute', async () => {
      const { subscriptionId } = await freshSubscription(tenant1);

      const rejectedInvoice = await newInvoice(tenant1, subscriptionId);
      const rejectedPayment = await submitProofOk(rejectedInvoice.id);
      const rejected = await gql(
        REJECT_UPI,
        { input: { paymentId: rejectedPayment.id, reason: 'no match' } },
        resellerToken,
      );
      expect(rejected.errors).toBeUndefined();

      const cashInvoice = await newInvoice(tenant1, subscriptionId);
      const cash = await gql(
        RECORD_MANUAL,
        {
          invoiceId: cashInvoice.id,
          input: { method: 'CASH', amountPaise: String(Number(cashInvoice.totalAmount)) },
        },
        resellerToken,
      );
      expect(cash.errors).toBeUndefined();

      const pendingInvoice = await newInvoice(tenant1, subscriptionId);
      await submitProofOk(pendingInvoice.id);

      const history = await paymentHistory();
      const byInvoice = new Map(history.map((p) => [p.invoiceId, p]));

      const rejectedRow = byInvoice.get(rejectedInvoice.id);
      expect(rejectedRow?.status).toBe('FAILED');
      expect(rejectedRow?.verificationStatus).toBe('REJECTED');

      const cashRow = byInvoice.get(cashInvoice.id);
      expect(cashRow?.status).toBe('SUCCEEDED');
      expect(cashRow?.method).toBe('CASH');

      const pendingRow = byInvoice.get(pendingInvoice.id);
      expect(pendingRow?.status).toBe('SUCCEEDED');
      expect(pendingRow?.method).toBe('UPI_P2P');
      expect(pendingRow?.verificationStatus).toBe('PENDING_VERIFICATION');

      expect(history.every((p) => p.tenantId === tenant1)).toBe(true);
      const otherIds = new Set((await paymentHistory(otherInstituteToken)).map((p) => p.id));
      for (const row of [rejectedRow, cashRow, pendingRow]) {
        assert(row);
        expect(otherIds.has(row.id)).toBe(false);
      }
    });
  });
});
