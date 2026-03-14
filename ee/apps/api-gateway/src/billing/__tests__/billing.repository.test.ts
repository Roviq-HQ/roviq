import { createMongoAbility } from '@casl/ability';
import type { AppAbility } from '@roviq/common-types';
import {
  BillingInterval,
  InvoiceStatus,
  PaymentProvider,
  SubscriptionStatus,
} from '@roviq/ee-billing-types';
import type { AdminPrismaClient, Prisma } from '@roviq/prisma-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@casl/prisma', () => ({
  accessibleBy: vi.fn().mockReturnValue(
    new Proxy(
      {},
      {
        get: () => ({ caslCondition: true }),
      },
    ),
  ),
}));

import { BillingRepository } from '../billing.repository';

function createMockAbility(): AppAbility {
  return createMongoAbility<AppAbility>([]);
}

function createMockPrisma() {
  return {
    subscriptionPlan: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    subscription: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    invoice: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    paymentGatewayConfig: {
      upsert: vi.fn(),
    },
    organization: {
      findUniqueOrThrow: vi.fn(),
    },
    paymentEvent: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  };
}

describe('BillingRepository', () => {
  let repo: BillingRepository;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();
    repo = new BillingRepository(prisma as unknown as AdminPrismaClient);
  });

  // ---------------------------------------------------------------------------
  // Plans
  // ---------------------------------------------------------------------------

  describe('createPlan', () => {
    it('should call prisma.subscriptionPlan.create with data', async () => {
      const data: Prisma.SubscriptionPlanCreateInput = {
        name: 'Pro',
        amount: 99900,
        currency: 'INR',
        billingInterval: BillingInterval.MONTHLY,
        featureLimits: { maxUsers: 100 },
      };
      const expected = { id: 'plan-1', ...data };
      prisma.subscriptionPlan.create.mockResolvedValue(expected);

      const result = await repo.createPlan(data);

      expect(prisma.subscriptionPlan.create).toHaveBeenCalledWith({ data });
      expect(result).toEqual(expected);
    });
  });

  describe('updatePlan', () => {
    it('should call prisma.subscriptionPlan.update with id and data', async () => {
      const data: Prisma.SubscriptionPlanUpdateInput = { name: 'Pro Plus' };
      const expected = { id: 'plan-1', name: 'Pro Plus' };
      prisma.subscriptionPlan.update.mockResolvedValue(expected);

      const result = await repo.updatePlan('plan-1', data);

      expect(prisma.subscriptionPlan.update).toHaveBeenCalledWith({
        where: { id: 'plan-1' },
        data,
      });
      expect(result).toEqual(expected);
    });
  });

  describe('findAllPlans', () => {
    it('should return all plans without ability filter', async () => {
      const plans = [{ id: 'plan-1' }, { id: 'plan-2' }];
      prisma.subscriptionPlan.findMany.mockResolvedValue(plans);

      const result = await repo.findAllPlans();

      expect(prisma.subscriptionPlan.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(plans);
    });

    it('should apply ability-based where clause when ability is provided', async () => {
      const mockAbility = createMockAbility();
      prisma.subscriptionPlan.findMany.mockResolvedValue([]);

      await repo.findAllPlans(mockAbility);

      expect(prisma.subscriptionPlan.findMany).toHaveBeenCalledWith({
        where: { caslCondition: true },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findPlanById', () => {
    it('should find plan by id without ability', async () => {
      const plan = { id: 'plan-1', name: 'Pro' };
      prisma.subscriptionPlan.findFirst.mockResolvedValue(plan);

      const result = await repo.findPlanById('plan-1');

      expect(prisma.subscriptionPlan.findFirst).toHaveBeenCalledWith({
        where: { AND: [{ id: 'plan-1' }, {}] },
      });
      expect(result).toEqual(plan);
    });

    it('should apply accessibleBy conditions when ability is provided', async () => {
      const mockAbility = createMockAbility();
      prisma.subscriptionPlan.findFirst.mockResolvedValue({ id: 'plan-1' });

      await repo.findPlanById('plan-1', mockAbility);

      expect(prisma.subscriptionPlan.findFirst).toHaveBeenCalledWith({
        where: { AND: [{ id: 'plan-1' }, { caslCondition: true }] },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Subscriptions
  // ---------------------------------------------------------------------------

  describe('createSubscription', () => {
    it('should call prisma.subscription.create with data', async () => {
      const data: Prisma.SubscriptionUncheckedCreateInput = {
        organizationId: 'org-1',
        planId: 'plan-1',
        status: SubscriptionStatus.PENDING_PAYMENT,
        providerSubscriptionId: 'rzp_sub_1',
      };
      const expected = { id: 'sub-1', ...data };
      prisma.subscription.create.mockResolvedValue(expected);

      const result = await repo.createSubscription(data);

      expect(prisma.subscription.create).toHaveBeenCalledWith({
        data,
        include: { plan: true },
      });
      expect(result).toEqual(expected);
    });
  });

  describe('updateSubscription', () => {
    it('should update without including plan relation', async () => {
      const data: Prisma.SubscriptionUpdateInput = {
        status: SubscriptionStatus.CANCELED,
        canceledAt: new Date(),
      };
      prisma.subscription.update.mockResolvedValue({ id: 'sub-1', ...data });

      await repo.updateSubscription('sub-1', data);

      const call = prisma.subscription.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'sub-1' });
      expect(call.data).toEqual(data);
      expect(call.include).toBeUndefined();
    });
  });

  describe('updateSubscriptionWithPlan', () => {
    it('should update subscription and include plan', async () => {
      const data: Prisma.SubscriptionUpdateInput = {
        status: SubscriptionStatus.ACTIVE,
      };
      const expected = {
        id: 'sub-1',
        status: 'ACTIVE',
        plan: { id: 'plan-1', amount: 99900 },
      };
      prisma.subscription.update.mockResolvedValue(expected);

      const result = await repo.updateSubscriptionWithPlan('sub-1', data);

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data,
        include: { plan: true },
      });
      expect(result).toEqual(expected);
    });
  });

  describe('findSubscriptionById', () => {
    it('should find subscription by id', async () => {
      const sub = { id: 'sub-1', status: 'ACTIVE' };
      prisma.subscription.findFirst.mockResolvedValue(sub);

      const result = await repo.findSubscriptionById('sub-1');

      expect(prisma.subscription.findFirst).toHaveBeenCalledWith({
        where: { AND: [{ id: 'sub-1' }, {}] },
      });
      expect(result).toEqual(sub);
    });
  });

  describe('findSubscriptionByOrg', () => {
    it('should find latest subscription for organization', async () => {
      const sub = { id: 'sub-1', organizationId: 'org-1', plan: { id: 'plan-1' } };
      prisma.subscription.findFirst.mockResolvedValue(sub);

      const result = await repo.findSubscriptionByOrg('org-1');

      expect(prisma.subscription.findFirst).toHaveBeenCalledWith({
        where: { AND: [{ organizationId: 'org-1' }, {}] },
        orderBy: { createdAt: 'desc' },
        include: { plan: true },
      });
      expect(result).toEqual(sub);
    });
  });

  describe('findSubscriptionByProviderId', () => {
    it('should find subscription by provider subscription ID', async () => {
      const sub = { id: 'sub-1', providerSubscriptionId: 'rzp_sub_1' };
      prisma.subscription.findFirst.mockResolvedValue(sub);

      const result = await repo.findSubscriptionByProviderId('rzp_sub_1');

      expect(prisma.subscription.findFirst).toHaveBeenCalledWith({
        where: { providerSubscriptionId: 'rzp_sub_1' },
      });
      expect(result).toEqual(sub);
    });
  });

  describe('findAllSubscriptions', () => {
    it('should return items and totalCount', async () => {
      const items = [{ id: 'sub-1' }, { id: 'sub-2' }];
      prisma.subscription.findMany.mockResolvedValue(items);
      prisma.subscription.count.mockResolvedValue(2);

      const result = await repo.findAllSubscriptions({ first: 21 });

      expect(result).toEqual({ items, totalCount: 2 });
      expect(prisma.subscription.findMany).toHaveBeenCalled();
      expect(prisma.subscription.count).toHaveBeenCalled();
    });

    it('should apply status filter', async () => {
      prisma.subscription.findMany.mockResolvedValue([]);
      prisma.subscription.count.mockResolvedValue(0);

      await repo.findAllSubscriptions({
        filter: { status: SubscriptionStatus.ACTIVE },
        first: 21,
      });

      const findManyCall = prisma.subscription.findMany.mock.calls[0][0];
      expect(findManyCall.where).toEqual({ AND: [{ status: 'ACTIVE' }] });
    });

    it('should handle cursor-based pagination', async () => {
      prisma.subscription.findMany.mockResolvedValue([]);
      prisma.subscription.count.mockResolvedValue(0);

      await repo.findAllSubscriptions({ after: 'cursor-id', first: 10 });

      const findManyCall = prisma.subscription.findMany.mock.calls[0][0];
      expect(findManyCall.cursor).toEqual({ id: 'cursor-id' });
      expect(findManyCall.skip).toBe(1);
      expect(findManyCall.take).toBe(10); // repo uses first directly; service passes take+1
    });

    it('should include organization and plan in results', async () => {
      prisma.subscription.findMany.mockResolvedValue([]);
      prisma.subscription.count.mockResolvedValue(0);

      await repo.findAllSubscriptions({ first: 21 });

      const findManyCall = prisma.subscription.findMany.mock.calls[0][0];
      expect(findManyCall.include).toEqual({
        organization: { select: { id: true, name: true } },
        plan: true,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Invoices
  // ---------------------------------------------------------------------------

  describe('createInvoice', () => {
    it('should call prisma.invoice.create with data', async () => {
      const data: Prisma.InvoiceUncheckedCreateInput = {
        subscriptionId: 'sub-1',
        organizationId: 'org-1',
        amount: 99900,
        currency: 'INR',
        status: InvoiceStatus.PAID,
        dueDate: new Date(),
        billingPeriodStart: new Date(),
        billingPeriodEnd: new Date(),
      };
      const expected = { id: 'inv-1', ...data };
      prisma.invoice.create.mockResolvedValue(expected);

      const result = await repo.createInvoice(data);

      expect(prisma.invoice.create).toHaveBeenCalledWith({ data });
      expect(result).toEqual(expected);
    });
  });

  describe('findInvoices', () => {
    it('should return items and totalCount', async () => {
      const items = [{ id: 'inv-1' }];
      prisma.invoice.findMany.mockResolvedValue(items);
      prisma.invoice.count.mockResolvedValue(1);

      const result = await repo.findInvoices({ first: 21 });

      expect(result).toEqual({ items, totalCount: 1 });
    });

    it('should filter by organizationId', async () => {
      prisma.invoice.findMany.mockResolvedValue([]);
      prisma.invoice.count.mockResolvedValue(0);

      await repo.findInvoices({ organizationId: 'org-1', first: 21 });

      const findManyCall = prisma.invoice.findMany.mock.calls[0][0];
      expect(findManyCall.where).toEqual({ AND: [{ organizationId: 'org-1' }] });
    });

    it('should filter by status', async () => {
      prisma.invoice.findMany.mockResolvedValue([]);
      prisma.invoice.count.mockResolvedValue(0);

      await repo.findInvoices({ filter: { status: InvoiceStatus.PAID }, first: 21 });

      const findManyCall = prisma.invoice.findMany.mock.calls[0][0];
      expect(findManyCall.where).toEqual({ AND: [{ status: 'PAID' }] });
    });

    it('should filter by date range', async () => {
      const from = new Date('2026-01-01');
      const to = new Date('2026-01-31');
      prisma.invoice.findMany.mockResolvedValue([]);
      prisma.invoice.count.mockResolvedValue(0);

      await repo.findInvoices({ filter: { from, to }, first: 21 });

      const findManyCall = prisma.invoice.findMany.mock.calls[0][0];
      expect(findManyCall.where).toEqual({
        AND: [{ createdAt: { gte: from, lte: to } }],
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Payment Infrastructure
  // ---------------------------------------------------------------------------

  describe('upsertGatewayConfig', () => {
    it('should call prisma.paymentGatewayConfig.upsert', async () => {
      prisma.paymentGatewayConfig.upsert.mockResolvedValue({
        organizationId: 'org-1',
        provider: 'RAZORPAY',
        isActive: true,
      });

      await repo.upsertGatewayConfig('org-1', PaymentProvider.RAZORPAY);

      expect(prisma.paymentGatewayConfig.upsert).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
        create: { organizationId: 'org-1', provider: 'RAZORPAY', isActive: true },
        update: { provider: 'RAZORPAY', isActive: true },
      });
    });
  });

  describe('findOrganizationById', () => {
    it('should call prisma.organization.findUniqueOrThrow', async () => {
      const org = { id: 'org-1', name: 'Demo', slug: 'demo' };
      prisma.organization.findUniqueOrThrow.mockResolvedValue(org);

      const result = await repo.findOrganizationById('org-1');

      expect(prisma.organization.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'org-1' },
      });
      expect(result).toEqual(org);
    });
  });

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  describe('findPaymentEvent', () => {
    it('should call prisma.paymentEvent.findUnique', async () => {
      prisma.paymentEvent.findUnique.mockResolvedValue(null);

      const result = await repo.findPaymentEvent('evt-1');

      expect(prisma.paymentEvent.findUnique).toHaveBeenCalledWith({
        where: { providerEventId: 'evt-1' },
      });
      expect(result).toBeNull();
    });
  });

  describe('upsertPaymentEvent', () => {
    it('should call prisma.paymentEvent.upsert with correct shape', async () => {
      const processedAt = new Date();
      const data = {
        provider: PaymentProvider.RAZORPAY,
        eventType: 'payment.captured',
        providerEventId: 'evt-1',
        subscriptionId: 'sub-1',
        organizationId: 'org-1',
        payload: { raw: true },
        processedAt,
      };
      prisma.paymentEvent.upsert.mockResolvedValue({ id: 'pe-1', ...data });

      await repo.upsertPaymentEvent(data);

      expect(prisma.paymentEvent.upsert).toHaveBeenCalledWith({
        where: { providerEventId: 'evt-1' },
        create: {
          provider: 'RAZORPAY',
          eventType: 'payment.captured',
          providerEventId: 'evt-1',
          subscriptionId: 'sub-1',
          organizationId: 'org-1',
          payload: { raw: true },
          processedAt,
        },
        update: { processedAt },
      });
    });

    it('should handle null subscriptionId and organizationId', async () => {
      const processedAt = new Date();
      const data = {
        provider: PaymentProvider.CASHFREE,
        eventType: 'payment.failed',
        providerEventId: 'evt-2',
        subscriptionId: null,
        organizationId: null,
        payload: {},
        processedAt,
      };
      prisma.paymentEvent.upsert.mockResolvedValue({ id: 'pe-2', ...data });

      await repo.upsertPaymentEvent(data);

      expect(prisma.paymentEvent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            subscriptionId: null,
            organizationId: null,
          }),
        }),
      );
    });
  });

  describe('claimPaymentEvent', () => {
    it('should return true on first claim', async () => {
      prisma.paymentEvent.create.mockResolvedValue({ id: 'pe-1' });

      const result = await repo.claimPaymentEvent('evt-1', {
        provider: PaymentProvider.RAZORPAY,
        eventType: 'payment.captured',
        payload: { raw: true },
      });

      expect(result).toBe(true);
      expect(prisma.paymentEvent.create).toHaveBeenCalledWith({
        data: {
          providerEventId: 'evt-1',
          provider: 'RAZORPAY',
          eventType: 'payment.captured',
          payload: { raw: true },
        },
      });
    });

    it('should return false on duplicate (P2002 unique constraint)', async () => {
      const error = new Error('Unique constraint');
      Object.assign(error, { code: 'P2002' });
      prisma.paymentEvent.create.mockRejectedValue(error);

      const result = await repo.claimPaymentEvent('evt-1', {
        provider: PaymentProvider.RAZORPAY,
        eventType: 'payment.captured',
        payload: {},
      });

      expect(result).toBe(false);
    });

    it('should re-throw non-P2002 errors', async () => {
      prisma.paymentEvent.create.mockRejectedValue(new Error('Connection lost'));

      await expect(
        repo.claimPaymentEvent('evt-1', {
          provider: PaymentProvider.RAZORPAY,
          eventType: 'payment.captured',
          payload: {},
        }),
      ).rejects.toThrow('Connection lost');
    });
  });

  describe('markPaymentEventProcessed', () => {
    it('should update event with processedAt and linked IDs', async () => {
      prisma.paymentEvent.update.mockResolvedValue({ id: 'pe-1' });

      await repo.markPaymentEventProcessed('evt-1', {
        subscriptionId: 'sub-1',
        organizationId: 'org-1',
      });

      expect(prisma.paymentEvent.update).toHaveBeenCalledWith({
        where: { providerEventId: 'evt-1' },
        data: {
          subscriptionId: 'sub-1',
          organizationId: 'org-1',
          processedAt: expect.any(Date),
        },
      });
    });
  });
});
