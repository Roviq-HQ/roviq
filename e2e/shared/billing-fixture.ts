import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { E2E_USERS, SEED } from './seed-fixtures';

/**
 * The seed has no billing rows, so the billing UI specs make sure the first institute has
 * a live subscription and one invoice. Safe to call repeatedly: it reuses what exists.
 */

const API_URL =
  process.env.API_URL || `http://localhost:${process.env.E2E_API_PORT ?? '3004'}/api/graphql`;

export interface BillingFixture {
  subscriptionId: string;
  invoiceId: string;
  invoiceNumber: string;
}

interface GraphqlBody<TData> {
  data?: TData;
  errors?: Array<{ message: string }>;
}

export async function ensureBillingFixture(request: APIRequestContext): Promise<BillingFixture> {
  const tenantId = SEED.INSTITUTE_1.id;

  const call = async <TData>(
    query: string,
    variables: Record<string, unknown>,
    token?: string,
  ): Promise<TData> => {
    const res = await request.post(API_URL, {
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      data: { query, variables },
    });
    const body: GraphqlBody<TData> = await res.json();
    if (body.errors?.length || !body.data) {
      throw new Error(`Billing fixture call failed: ${JSON.stringify(body.errors ?? body)}`);
    }
    return body.data;
  };

  const login = await call<{ resellerLogin: { accessToken: string } }>(
    `mutation($username: String!, $password: String!) {
      resellerLogin(username: $username, password: $password) { accessToken }
    }`,
    { username: E2E_USERS.RESELLER.username, password: E2E_USERS.RESELLER.password },
  );
  const token = login.resellerLogin.accessToken;

  const findLiveSubscription = async () => {
    const subs = await call<{
      subscriptions: Array<{ id: string; status: string; tenantId: string }>;
    }>('query { subscriptions(first: 100) { id status tenantId } }', {}, token);
    return subs.subscriptions.find(
      (s) => s.tenantId === tenantId && s.status !== 'CANCELLED' && s.status !== 'EXPIRED',
    )?.id;
  };
  let subscriptionId = await findLiveSubscription();

  if (!subscriptionId) {
    const suffix = randomUUID().slice(0, 8);
    const plan = await call<{ createSubscriptionPlan: { id: string } }>(
      'mutation($input: CreatePlanInput!) { createSubscriptionPlan(input: $input) { id } }',
      {
        input: {
          name: { en: `E2E Billing Plan ${suffix}` },
          description: { en: 'Created by the billing UI specs' },
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
          code: `E2EUI-${suffix.toUpperCase()}`,
        },
      },
      token,
    );
    try {
      const assigned = await call<{
        assignPlanToInstitute: { subscription: { id: string } };
      }>(
        'mutation($input: AssignPlanInput!) { assignPlanToInstitute(input: $input) { subscription { id } } }',
        { input: { tenantId, planId: plan.createSubscriptionPlan.id } },
        token,
      );
      subscriptionId = assigned.assignPlanToInstitute.subscription.id;
    } catch (err) {
      // Spec files set up in parallel workers: another one may have assigned a plan first.
      subscriptionId = await findLiveSubscription();
      if (!subscriptionId) throw err;
    }
  }

  const invoices = await call<{
    invoices: Array<{ id: string; invoiceNumber: string; tenantId: string }>;
  }>('query { invoices(first: 100) { id invoiceNumber tenantId } }', {}, token);
  const existing = invoices.invoices.find((i) => i.tenantId === tenantId);
  if (existing) {
    return { subscriptionId, invoiceId: existing.id, invoiceNumber: existing.invoiceNumber };
  }

  const created = await call<{ generateInvoice: { id: string; invoiceNumber: string } }>(
    'mutation($input: GenerateInvoiceInput!) { generateInvoice(input: $input) { id invoiceNumber } }',
    { input: { tenantId, subscriptionId } },
    token,
  );
  return {
    subscriptionId,
    invoiceId: created.generateInvoice.id,
    invoiceNumber: created.generateInvoice.invoiceNumber,
  };
}

/** A fresh invoice for the first institute, fully paid in cash, so a refund can be issued on it. */
export async function createPaidInvoice(
  request: APIRequestContext,
  fixture: BillingFixture,
): Promise<{ invoiceId: string; invoiceNumber: string }> {
  const call = async <TData>(
    query: string,
    variables: Record<string, unknown>,
    token?: string,
  ): Promise<TData> => {
    const res = await request.post(API_URL, {
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      data: { query, variables },
    });
    const body: GraphqlBody<TData> = await res.json();
    if (body.errors?.length || !body.data) {
      throw new Error(`Billing fixture call failed: ${JSON.stringify(body.errors ?? body)}`);
    }
    return body.data;
  };

  const login = await call<{ resellerLogin: { accessToken: string } }>(
    `mutation($username: String!, $password: String!) {
      resellerLogin(username: $username, password: $password) { accessToken }
    }`,
    { username: E2E_USERS.RESELLER.username, password: E2E_USERS.RESELLER.password },
  );
  const token = login.resellerLogin.accessToken;

  const created = await call<{
    generateInvoice: { id: string; invoiceNumber: string; totalAmount: string | number };
  }>(
    'mutation($input: GenerateInvoiceInput!) { generateInvoice(input: $input) { id invoiceNumber totalAmount } }',
    { input: { tenantId: SEED.INSTITUTE_1.id, subscriptionId: fixture.subscriptionId } },
    token,
  );
  await call(
    'mutation($invoiceId: ID!, $input: ManualPaymentInput!) { recordManualPayment(invoiceId: $invoiceId, input: $input) { id } }',
    {
      invoiceId: created.generateInvoice.id,
      input: { method: 'CASH', amountPaise: String(created.generateInvoice.totalAmount) },
    },
    token,
  );
  return {
    invoiceId: created.generateInvoice.id,
    invoiceNumber: created.generateInvoice.invoiceNumber,
  };
}
