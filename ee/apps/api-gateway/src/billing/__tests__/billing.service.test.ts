import { createMongoAbility } from '@casl/ability';
import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppAbility } from '@roviq/common-types';
import { BillingInterval, PaymentProvider, SubscriptionStatus } from '@roviq/ee-billing-types';
import { PaymentGatewayError } from '@roviq/ee-payments';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingRepository } from '../billing.repository';
import { BillingService } from '../billing.service';

function createMockAbility(): AppAbility {
  return createMongoAbility<AppAbility>([]);
}

function createMockRepo() {
  return {
    createPlan: vi.fn(),
    updatePlan: vi.fn(),
    findAllPlans: vi.fn(),
    findPlanById: vi.fn(),
    createSubscription: vi.fn(),
    updateSubscription: vi.fn(),
    updateSubscriptionWithPlan: vi.fn(),
    findSubscriptionById: vi.fn(),
    findSubscriptionByOrg: vi.fn(),
    findSubscriptionByProviderId: vi.fn(),
    findAllSubscriptions: vi.fn(),
    createInvoice: vi.fn(),
    findInvoiceByProviderPaymentId: vi.fn(),
    findInvoices: vi.fn(),
    upsertGatewayConfig: vi.fn(),
    findOrganizationById: vi.fn(),
    findAllOrganizations: vi.fn(),
    findPaymentEvent: vi.fn(),
    upsertPaymentEvent: vi.fn(),
    claimPaymentEvent: vi.fn(),
    markPaymentEventProcessed: vi.fn(),
  } satisfies Record<keyof BillingRepository, ReturnType<typeof vi.fn>>;
}

function createMockNatsClient() {
  return {
    emit: vi.fn().mockReturnValue({ subscribe: vi.fn() }),
    send: vi.fn(),
    connect: vi.fn(),
    close: vi.fn(),
  };
}

function createMockGatewayFactory() {
  const mockGateway = {
    createPlan: vi.fn(),
    createSubscription: vi.fn(),
    cancelSubscription: vi.fn(),
    pauseSubscription: vi.fn(),
    resumeSubscription: vi.fn(),
  };
  return {
    getForProvider: vi.fn().mockReturnValue(mockGateway),
    getForOrganization: vi.fn().mockResolvedValue(mockGateway),
    _mockGateway: mockGateway,
  };
}

describe('BillingService', () => {
  let service: BillingService;
  let repo: ReturnType<typeof createMockRepo>;
  let natsClient: ReturnType<typeof createMockNatsClient>;
  let factory: ReturnType<typeof createMockGatewayFactory>;
  const config = {
    get: vi.fn().mockReturnValue('http://localhost:3000'),
    getOrThrow: vi.fn().mockReturnValue('http://localhost:3000'),
  } as unknown as ConfigService;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = createMockRepo();
    natsClient = createMockNatsClient();
    factory = createMockGatewayFactory();
    // Default: no existing invoice — allows invoice creation in webhook tests
    repo.findInvoiceByProviderPaymentId.mockResolvedValue(null);
    service = new BillingService(
      repo as unknown as BillingRepository,
      natsClient as unknown as BillingService['natsClient'],
      factory as unknown as BillingService['gatewayFactory'],
      config,
    );
  });

  // ---------------------------------------------------------------------------
  // createPlan
  // ---------------------------------------------------------------------------

  describe('createPlan', () => {
    it('should create a subscription plan and emit event', async () => {
      const input = {
        name: 'Pro',
        amount: 99900,
        currency: 'INR',
        billingInterval: BillingInterval.MONTHLY,
        featureLimits: { maxUsers: 100 },
      };
      repo.createPlan.mockResolvedValue({ id: 'plan-1', ...input, name: 'Pro' });

      const result = await service.createPlan(input);

      expect(repo.createPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Pro',
          amount: 99900,
          featureLimits: { maxUsers: 100 },
        }),
      );
      expect(result.id).toBe('plan-1');
      expect(natsClient.emit).toHaveBeenCalledWith('billing.plan.created', {
        id: 'plan-1',
        name: 'Pro',
      });
    });

    it('should pass featureLimits object to repo', async () => {
      const input = {
        name: 'Starter',
        amount: 49900,
        currency: 'INR',
        billingInterval: BillingInterval.YEARLY,
        featureLimits: { maxUsers: 10, maxStorageGb: 5 },
      };
      repo.createPlan.mockResolvedValue({ id: 'plan-2', name: 'Starter' });

      await service.createPlan(input);

      expect(repo.createPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          featureLimits: { maxUsers: 10, maxStorageGb: 5 },
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // updatePlan
  // ---------------------------------------------------------------------------

  describe('updatePlan', () => {
    it('should update a plan and emit event', async () => {
      repo.updatePlan.mockResolvedValue({ id: 'plan-1', name: 'Pro Plus' });

      await service.updatePlan('plan-1', { name: 'Pro Plus' });

      expect(repo.updatePlan).toHaveBeenCalledWith(
        'plan-1',
        expect.objectContaining({ name: 'Pro Plus' }),
      );
      expect(natsClient.emit).toHaveBeenCalledWith('billing.plan.updated', { id: 'plan-1' });
    });

    it('should only include defined fields in the update', async () => {
      repo.updatePlan.mockResolvedValue({ id: 'plan-1' });

      await service.updatePlan('plan-1', { name: 'Updated', amount: undefined });

      const updateData = repo.updatePlan.mock.calls[0][1];
      expect(updateData).toEqual({ name: 'Updated' });
      expect(updateData).not.toHaveProperty('amount');
    });

    it('should pass featureLimits object in update', async () => {
      repo.updatePlan.mockResolvedValue({ id: 'plan-1' });

      await service.updatePlan('plan-1', { featureLimits: { maxUsers: 200 } });

      expect(repo.updatePlan).toHaveBeenCalledWith(
        'plan-1',
        expect.objectContaining({ featureLimits: { maxUsers: 200 } }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // findAllPlans
  // ---------------------------------------------------------------------------

  describe('findAllPlans', () => {
    it('should pass ability to repo', async () => {
      const mockAbility = createMockAbility();
      repo.findAllPlans.mockResolvedValue([]);

      await service.findAllPlans(mockAbility);

      expect(repo.findAllPlans).toHaveBeenCalledWith(mockAbility);
    });

    it('should work without ability (admin)', async () => {
      repo.findAllPlans.mockResolvedValue([{ id: 'plan-1' }]);

      const result = await service.findAllPlans();

      expect(repo.findAllPlans).toHaveBeenCalledWith(undefined);
      expect(result).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // assignPlanToOrganization
  // ---------------------------------------------------------------------------

  describe('assignPlanToOrganization', () => {
    it('should reject inactive plans', async () => {
      repo.findPlanById.mockResolvedValue({ isActive: false });

      await expect(
        service.assignPlanToOrganization({
          organizationId: 'org-1',
          planId: 'plan-1',
          provider: PaymentProvider.RAZORPAY,
          customerEmail: 'billing@demo.com',
          customerPhone: '9876543210',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject org with existing active subscription', async () => {
      repo.findSubscriptionByOrg.mockResolvedValue({
        id: 'sub-existing',
        status: 'ACTIVE',
      });

      await expect(
        service.assignPlanToOrganization({
          organizationId: 'org-1',
          planId: 'plan-1',
          provider: PaymentProvider.RAZORPAY,
          customerEmail: 'billing@demo.com',
          customerPhone: '9876543210',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create provider plan, subscription, gateway config, and emit event', async () => {
      repo.findPlanById.mockResolvedValue({
        id: 'plan-1',
        name: 'Pro',
        amount: 99900,
        currency: 'INR',
        billingInterval: 'MONTHLY',
        isActive: true,
      });
      repo.findOrganizationById.mockResolvedValue({
        id: 'org-1',
        name: 'Demo',
        slug: 'demo',
      });
      factory._mockGateway.createPlan.mockResolvedValue({ providerPlanId: 'rzp_plan_1' });
      factory._mockGateway.createSubscription.mockResolvedValue({
        providerSubscriptionId: 'rzp_sub_1',
        checkoutUrl: 'https://checkout.url',
      });
      repo.upsertGatewayConfig.mockResolvedValue({});
      repo.createSubscription.mockResolvedValue({ id: 'sub-1' });

      const result = await service.assignPlanToOrganization({
        organizationId: 'org-1',
        planId: 'plan-1',
        provider: PaymentProvider.RAZORPAY,
        customerEmail: 'billing@demo.com',
        customerPhone: '9876543210',
      });

      expect(result.checkoutUrl).toBe('https://checkout.url');
      expect(factory.getForProvider).toHaveBeenCalledWith('RAZORPAY');
      expect(factory._mockGateway.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: { name: 'Demo', email: 'billing@demo.com', phone: '9876543210' },
        }),
      );
      expect(repo.upsertGatewayConfig).toHaveBeenCalledWith('org-1', 'RAZORPAY');
      expect(repo.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          planId: 'plan-1',
          status: 'PENDING_PAYMENT',
          providerSubscriptionId: 'rzp_sub_1',
        }),
      );
      expect(natsClient.emit).toHaveBeenCalledWith('billing.subscription.created', {
        subscriptionId: 'sub-1',
        organizationId: 'org-1',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // cancelSubscription
  // ---------------------------------------------------------------------------

  describe('cancelSubscription', () => {
    it('should cancel at cycle end — keep status, record canceledAt', async () => {
      repo.findSubscriptionById.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
        status: 'ACTIVE',
        providerSubscriptionId: 'rzp_sub_1',
      });
      repo.updateSubscription.mockResolvedValue({ id: 'sub-1', status: 'ACTIVE' });

      await service.cancelSubscription('sub-1', true);

      expect(factory._mockGateway.cancelSubscription).toHaveBeenCalledWith('rzp_sub_1', true);
      expect(repo.updateSubscription).toHaveBeenCalledWith('sub-1', {
        canceledAt: expect.any(Date),
      });
      expect(natsClient.emit).toHaveBeenCalledWith('billing.subscription.canceled', {
        subscriptionId: 'sub-1',
      });
    });

    it('should cancel immediately — set status to CANCELED', async () => {
      repo.findSubscriptionById.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
        status: 'ACTIVE',
        providerSubscriptionId: 'rzp_sub_1',
      });
      repo.updateSubscription.mockResolvedValue({ id: 'sub-1', status: 'CANCELED' });

      await service.cancelSubscription('sub-1', false);

      expect(factory._mockGateway.cancelSubscription).toHaveBeenCalledWith('rzp_sub_1', false);
      expect(repo.updateSubscription).toHaveBeenCalledWith('sub-1', {
        status: 'CANCELED',
        canceledAt: expect.any(Date),
      });
    });

    it('should reject already canceled subscriptions', async () => {
      repo.findSubscriptionById.mockResolvedValue({
        id: 'sub-1',
        status: 'CANCELED',
        providerSubscriptionId: 'rzp_sub_1',
      });

      await expect(service.cancelSubscription('sub-1')).rejects.toThrow(BadRequestException);
    });

    it('should reject completed subscriptions', async () => {
      repo.findSubscriptionById.mockResolvedValue({
        id: 'sub-1',
        status: 'COMPLETED',
        providerSubscriptionId: 'rzp_sub_1',
      });

      await expect(service.cancelSubscription('sub-1')).rejects.toThrow(BadRequestException);
    });

    it('should cancel without gateway call when no provider link (free plan)', async () => {
      repo.findSubscriptionById.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
        status: 'ACTIVE',
        providerSubscriptionId: null,
      });
      repo.updateSubscription.mockResolvedValue({ id: 'sub-1', status: 'ACTIVE' });

      await service.cancelSubscription('sub-1', true);

      expect(factory._mockGateway.cancelSubscription).not.toHaveBeenCalled();
      expect(repo.updateSubscription).toHaveBeenCalledWith('sub-1', {
        canceledAt: expect.any(Date),
      });
    });

    it('should throw BadGatewayException when provider cancel fails', async () => {
      repo.findSubscriptionById.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
        status: 'ACTIVE',
        providerSubscriptionId: 'rzp_sub_1',
      });
      factory._mockGateway.cancelSubscription.mockRejectedValue(
        new PaymentGatewayError('Network error', 'RAZORPAY'),
      );

      await expect(service.cancelSubscription('sub-1')).rejects.toThrow(BadGatewayException);
      expect(repo.updateSubscription).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // pauseSubscription
  // ---------------------------------------------------------------------------

  describe('pauseSubscription', () => {
    it('should reject non-active subscriptions', async () => {
      repo.findSubscriptionById.mockResolvedValue({
        id: 'sub-1',
        status: 'PAUSED',
        providerSubscriptionId: 'rzp_sub_1',
      });

      await expect(service.pauseSubscription('sub-1')).rejects.toThrow(BadRequestException);
    });

    it('should pause via provider, update DB status, and emit event', async () => {
      repo.findSubscriptionById.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
        status: 'ACTIVE',
        providerSubscriptionId: 'rzp_sub_1',
      });
      repo.updateSubscription.mockResolvedValue({ id: 'sub-1', status: 'PAUSED' });

      await service.pauseSubscription('sub-1');

      expect(factory._mockGateway.pauseSubscription).toHaveBeenCalledWith('rzp_sub_1');
      expect(repo.updateSubscription).toHaveBeenCalledWith('sub-1', { status: 'PAUSED' });
      expect(natsClient.emit).toHaveBeenCalledWith('billing.subscription.paused', {
        subscriptionId: 'sub-1',
      });
    });

    it('should pause without gateway call when no provider link (free plan)', async () => {
      repo.findSubscriptionById.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
        status: 'ACTIVE',
        providerSubscriptionId: null,
      });
      repo.updateSubscription.mockResolvedValue({ id: 'sub-1', status: 'PAUSED' });

      await service.pauseSubscription('sub-1');

      expect(factory._mockGateway.pauseSubscription).not.toHaveBeenCalled();
      expect(repo.updateSubscription).toHaveBeenCalledWith('sub-1', { status: 'PAUSED' });
    });

    it('should throw BadGatewayException when provider pause fails', async () => {
      repo.findSubscriptionById.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
        status: 'ACTIVE',
        providerSubscriptionId: 'rzp_sub_1',
      });
      factory._mockGateway.pauseSubscription.mockRejectedValue(
        new PaymentGatewayError('Network error', 'RAZORPAY'),
      );

      await expect(service.pauseSubscription('sub-1')).rejects.toThrow(BadGatewayException);
      expect(repo.updateSubscription).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // resumeSubscription
  // ---------------------------------------------------------------------------

  describe('resumeSubscription', () => {
    it('should reject non-paused subscriptions', async () => {
      repo.findSubscriptionById.mockResolvedValue({
        id: 'sub-1',
        status: 'ACTIVE',
        providerSubscriptionId: 'rzp_sub_1',
      });

      await expect(service.resumeSubscription('sub-1')).rejects.toThrow(BadRequestException);
    });

    it('should resume via provider, update DB status, and emit event', async () => {
      repo.findSubscriptionById.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
        status: 'PAUSED',
        providerSubscriptionId: 'rzp_sub_1',
      });
      repo.updateSubscription.mockResolvedValue({ id: 'sub-1', status: 'ACTIVE' });

      await service.resumeSubscription('sub-1');

      expect(factory._mockGateway.resumeSubscription).toHaveBeenCalledWith('rzp_sub_1');
      expect(repo.updateSubscription).toHaveBeenCalledWith('sub-1', { status: 'ACTIVE' });
      expect(natsClient.emit).toHaveBeenCalledWith('billing.subscription.resumed', {
        subscriptionId: 'sub-1',
      });
    });

    it('should resume without gateway call when no provider link (free plan)', async () => {
      repo.findSubscriptionById.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
        status: 'PAUSED',
        providerSubscriptionId: null,
      });
      repo.updateSubscription.mockResolvedValue({ id: 'sub-1', status: 'ACTIVE' });

      await service.resumeSubscription('sub-1');

      expect(factory._mockGateway.resumeSubscription).not.toHaveBeenCalled();
      expect(repo.updateSubscription).toHaveBeenCalledWith('sub-1', { status: 'ACTIVE' });
    });

    it('should throw BadGatewayException when provider resume fails', async () => {
      repo.findSubscriptionById.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
        status: 'PAUSED',
        providerSubscriptionId: 'rzp_sub_1',
      });
      factory._mockGateway.resumeSubscription.mockRejectedValue(
        new PaymentGatewayError('Network error', 'RAZORPAY'),
      );

      await expect(service.resumeSubscription('sub-1')).rejects.toThrow(BadGatewayException);
      expect(repo.updateSubscription).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // processWebhookEvent
  // ---------------------------------------------------------------------------

  describe('processWebhookEvent', () => {
    it('should skip already-processed events (idempotency)', async () => {
      repo.claimPaymentEvent.mockResolvedValue(false);

      await service.processWebhookEvent('RAZORPAY', {
        eventType: 'payment.captured',
        providerEventId: 'evt-1',
        payload: {},
      });

      expect(repo.markPaymentEventProcessed).not.toHaveBeenCalled();
    });

    it('should store event via repo and emit NATS event', async () => {
      repo.claimPaymentEvent.mockResolvedValue(true);
      repo.markPaymentEventProcessed.mockResolvedValue(undefined);
      repo.findSubscriptionByProviderId.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
      });
      repo.updateSubscriptionWithPlan.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
        status: 'ACTIVE',
        plan: { amount: 99900, currency: 'INR', billingInterval: 'MONTHLY' },
      });
      repo.createInvoice.mockResolvedValue({ id: 'inv-1' });

      await service.processWebhookEvent('RAZORPAY', {
        eventType: 'payment.captured',
        providerEventId: 'evt-2',
        providerSubscriptionId: 'rzp_sub_1',
        providerPaymentId: 'pay_1',
        payload: { raw: true },
      });

      expect(repo.claimPaymentEvent).toHaveBeenCalledWith('evt-2', {
        provider: PaymentProvider.RAZORPAY,
        eventType: 'payment.captured',
        payload: { raw: true },
      });
      expect(repo.markPaymentEventProcessed).toHaveBeenCalledWith('evt-2', {
        subscriptionId: 'sub-1',
        organizationId: 'org-1',
      });
      expect(natsClient.emit).toHaveBeenCalledWith(
        'billing.webhook.razorpay',
        expect.objectContaining({
          eventType: 'payment.captured',
          providerEventId: 'evt-2',
          provider: PaymentProvider.RAZORPAY,
        }),
      );
    });

    it('should create invoice on charged/captured events using BillingPeriod', async () => {
      repo.claimPaymentEvent.mockResolvedValue(true);
      repo.markPaymentEventProcessed.mockResolvedValue(undefined);
      repo.findSubscriptionByProviderId.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
      });
      repo.updateSubscriptionWithPlan.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
        status: 'ACTIVE',
        plan: { amount: 99900, currency: 'INR', billingInterval: 'MONTHLY' },
      });
      repo.createInvoice.mockResolvedValue({ id: 'inv-1' });

      await service.processWebhookEvent('RAZORPAY', {
        eventType: 'payment.captured',
        providerEventId: 'evt-3',
        providerSubscriptionId: 'rzp_sub_1',
        providerPaymentId: 'pay_1',
        payload: {},
      });

      expect(repo.createInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: 'sub-1',
          organizationId: 'org-1',
          amount: 99900,
          currency: 'INR',
          status: 'PAID',
          providerPaymentId: 'pay_1',
          billingPeriodStart: expect.any(Date),
          billingPeriodEnd: expect.any(Date),
        }),
      );

      // Verify billing period is roughly one month apart
      const invoiceCall = repo.createInvoice.mock.calls[0][0];
      const start = invoiceCall.billingPeriodStart as Date;
      const end = invoiceCall.billingPeriodEnd as Date;
      const diffMs = end.getTime() - start.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThanOrEqual(28);
      expect(diffDays).toBeLessThanOrEqual(31);
    });

    it('should handle subscription activation events', async () => {
      repo.claimPaymentEvent.mockResolvedValue(true);
      repo.markPaymentEventProcessed.mockResolvedValue(undefined);
      repo.findSubscriptionByProviderId.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
      });
      repo.updateSubscriptionWithPlan.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
        status: 'ACTIVE',
        plan: { amount: 99900, currency: 'INR', billingInterval: 'MONTHLY' },
      });

      await service.processWebhookEvent('RAZORPAY', {
        eventType: 'subscription.activated',
        providerEventId: 'evt-4',
        providerSubscriptionId: 'rzp_sub_1',
        payload: {},
      });

      expect(repo.updateSubscriptionWithPlan).toHaveBeenCalledWith('sub-1', {
        status: 'ACTIVE',
      });
      // activated events don't create invoices
      expect(repo.createInvoice).not.toHaveBeenCalled();
    });

    it('should handle halted/past_due events', async () => {
      repo.claimPaymentEvent.mockResolvedValue(true);
      repo.markPaymentEventProcessed.mockResolvedValue(undefined);
      repo.findSubscriptionByProviderId.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
      });

      await service.processWebhookEvent('RAZORPAY', {
        eventType: 'subscription.halted',
        providerEventId: 'evt-5',
        providerSubscriptionId: 'rzp_sub_1',
        payload: {},
      });

      expect(repo.updateSubscription).toHaveBeenCalledWith('sub-1', { status: 'PAST_DUE' });
    });

    it('should handle cancelled events', async () => {
      repo.claimPaymentEvent.mockResolvedValue(true);
      repo.markPaymentEventProcessed.mockResolvedValue(undefined);
      repo.findSubscriptionByProviderId.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
      });

      await service.processWebhookEvent('RAZORPAY', {
        eventType: 'subscription.cancelled',
        providerEventId: 'evt-6',
        providerSubscriptionId: 'rzp_sub_1',
        payload: {},
      });

      expect(repo.updateSubscription).toHaveBeenCalledWith(
        'sub-1',
        expect.objectContaining({ status: 'CANCELED', canceledAt: expect.any(Date) }),
      );
    });

    it('should handle completed events', async () => {
      repo.claimPaymentEvent.mockResolvedValue(true);
      repo.markPaymentEventProcessed.mockResolvedValue(undefined);
      repo.findSubscriptionByProviderId.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
      });

      await service.processWebhookEvent('RAZORPAY', {
        eventType: 'subscription.completed',
        providerEventId: 'evt-7',
        providerSubscriptionId: 'rzp_sub_1',
        payload: {},
      });

      expect(repo.updateSubscription).toHaveBeenCalledWith('sub-1', { status: 'COMPLETED' });
    });

    it('should handle paused events', async () => {
      repo.claimPaymentEvent.mockResolvedValue(true);
      repo.markPaymentEventProcessed.mockResolvedValue(undefined);
      repo.findSubscriptionByProviderId.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
      });

      await service.processWebhookEvent('RAZORPAY', {
        eventType: 'subscription.paused',
        providerEventId: 'evt-8',
        providerSubscriptionId: 'rzp_sub_1',
        payload: {},
      });

      expect(repo.updateSubscription).toHaveBeenCalledWith('sub-1', { status: 'PAUSED' });
    });

    it('should handle resumed events', async () => {
      repo.claimPaymentEvent.mockResolvedValue(true);
      repo.markPaymentEventProcessed.mockResolvedValue(undefined);
      repo.findSubscriptionByProviderId.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
      });

      await service.processWebhookEvent('RAZORPAY', {
        eventType: 'subscription.resumed',
        providerEventId: 'evt-10',
        providerSubscriptionId: 'rzp_sub_1',
        payload: {},
      });

      expect(repo.updateSubscription).toHaveBeenCalledWith('sub-1', { status: 'ACTIVE' });
    });

    it('should handle pending events', async () => {
      repo.claimPaymentEvent.mockResolvedValue(true);
      repo.markPaymentEventProcessed.mockResolvedValue(undefined);
      repo.findSubscriptionByProviderId.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
      });

      await service.processWebhookEvent('RAZORPAY', {
        eventType: 'subscription.pending',
        providerEventId: 'evt-11',
        providerSubscriptionId: 'rzp_sub_1',
        payload: {},
      });

      expect(repo.updateSubscription).toHaveBeenCalledWith('sub-1', {
        status: 'PENDING_PAYMENT',
      });
    });

    it('should handle updated events without status change', async () => {
      repo.claimPaymentEvent.mockResolvedValue(true);
      repo.markPaymentEventProcessed.mockResolvedValue(undefined);
      repo.findSubscriptionByProviderId.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
      });

      await service.processWebhookEvent('RAZORPAY', {
        eventType: 'subscription.updated',
        providerEventId: 'evt-12',
        providerSubscriptionId: 'rzp_sub_1',
        payload: {},
      });

      // updated events only log — no status change
      expect(repo.updateSubscription).not.toHaveBeenCalled();
      expect(repo.updateSubscriptionWithPlan).not.toHaveBeenCalled();
    });

    it('should handle events without a subscription', async () => {
      repo.claimPaymentEvent.mockResolvedValue(true);
      repo.markPaymentEventProcessed.mockResolvedValue(undefined);

      await service.processWebhookEvent('CASHFREE', {
        eventType: 'payment.failed',
        providerEventId: 'evt-9',
        payload: {},
      });

      expect(repo.markPaymentEventProcessed).toHaveBeenCalledWith('evt-9', {
        subscriptionId: undefined,
        organizationId: undefined,
      });
      expect(natsClient.emit).toHaveBeenCalledWith(
        'billing.webhook.cashfree',
        expect.objectContaining({ provider: 'CASHFREE' }),
      );
    });

    // ── Normalized Cashfree events (adapter normalizes before service) ──────
    // These test that the service correctly handles the normalized event types
    // that the CashfreeAdapter produces from raw Cashfree webhook events.

    it('should handle normalized Cashfree subscription.charged — activate + invoice', async () => {
      repo.claimPaymentEvent.mockResolvedValue(true);
      repo.markPaymentEventProcessed.mockResolvedValue(undefined);
      repo.findSubscriptionByProviderId.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
      });
      repo.updateSubscriptionWithPlan.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
        status: 'ACTIVE',
        plan: { amount: 99900, currency: 'INR', billingInterval: 'MONTHLY' },
      });
      repo.createInvoice.mockResolvedValue({ id: 'inv-1' });

      await service.processWebhookEvent('CASHFREE', {
        eventType: 'subscription.charged',
        providerEventId: 'cf-evt-1',
        providerSubscriptionId: 'cf_sub_1',
        providerPaymentId: 'cf_pay_1',
        payload: {},
      });

      expect(repo.updateSubscriptionWithPlan).toHaveBeenCalledWith('sub-1', {
        status: 'ACTIVE',
      });
      expect(repo.createInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: 'sub-1',
          status: 'PAID',
          providerPaymentId: 'cf_pay_1',
        }),
      );
    });

    it('should handle normalized payment.failed — log only, no status change', async () => {
      repo.claimPaymentEvent.mockResolvedValue(true);
      repo.markPaymentEventProcessed.mockResolvedValue(undefined);
      repo.findSubscriptionByProviderId.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
      });

      await service.processWebhookEvent('CASHFREE', {
        eventType: 'payment.failed',
        providerEventId: 'cf-evt-2',
        providerSubscriptionId: 'cf_sub_1',
        providerPaymentId: 'cf_pay_2',
        payload: {},
      });

      expect(repo.updateSubscription).not.toHaveBeenCalled();
      expect(repo.updateSubscriptionWithPlan).not.toHaveBeenCalled();
      expect(repo.createInvoice).not.toHaveBeenCalled();
    });

    it('should handle normalized payment.cancelled — log only, NOT cancel subscription', async () => {
      repo.claimPaymentEvent.mockResolvedValue(true);
      repo.markPaymentEventProcessed.mockResolvedValue(undefined);
      repo.findSubscriptionByProviderId.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
      });

      await service.processWebhookEvent('CASHFREE', {
        eventType: 'payment.cancelled',
        providerEventId: 'cf-evt-3',
        providerSubscriptionId: 'cf_sub_1',
        payload: {},
      });

      // Must NOT cancel the subscription — this is a payment-level event
      expect(repo.updateSubscription).not.toHaveBeenCalled();
      expect(repo.updateSubscriptionWithPlan).not.toHaveBeenCalled();
    });

    it('should handle normalized subscription.card_expiry_reminder — log only', async () => {
      repo.claimPaymentEvent.mockResolvedValue(true);
      repo.markPaymentEventProcessed.mockResolvedValue(undefined);
      repo.findSubscriptionByProviderId.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
      });

      await service.processWebhookEvent('CASHFREE', {
        eventType: 'subscription.card_expiry_reminder',
        providerEventId: 'cf-evt-4',
        providerSubscriptionId: 'cf_sub_1',
        payload: {},
      });

      expect(repo.updateSubscription).not.toHaveBeenCalled();
      expect(repo.updateSubscriptionWithPlan).not.toHaveBeenCalled();
    });

    describe('normalized Cashfree status change events', () => {
      function setupNormalizedEvent(normalizedEventType: string) {
        repo.claimPaymentEvent.mockResolvedValue(true);
        repo.markPaymentEventProcessed.mockResolvedValue(undefined);
        repo.findSubscriptionByProviderId.mockResolvedValue({
          id: 'sub-1',
          organizationId: 'org-1',
        });

        return service.processWebhookEvent('CASHFREE', {
          eventType: normalizedEventType,
          providerEventId: `cf-status-${normalizedEventType}`,
          providerSubscriptionId: 'cf_sub_1',
          payload: {},
        });
      }

      it('should handle subscription.activated (from CF ACTIVE)', async () => {
        repo.updateSubscriptionWithPlan.mockResolvedValue({
          id: 'sub-1',
          organizationId: 'org-1',
          status: 'ACTIVE',
          plan: { amount: 99900, currency: 'INR', billingInterval: 'MONTHLY' },
        });

        await setupNormalizedEvent('subscription.activated');
        expect(repo.updateSubscriptionWithPlan).toHaveBeenCalledWith('sub-1', {
          status: 'ACTIVE',
        });
      });

      it('should handle subscription.cancelled (from CF CUSTOMER_CANCELLED)', async () => {
        await setupNormalizedEvent('subscription.cancelled');
        expect(repo.updateSubscription).toHaveBeenCalledWith('sub-1', {
          status: 'CANCELED',
          canceledAt: expect.any(Date),
        });
      });

      it('should handle subscription.paused (from CF CUSTOMER_PAUSED)', async () => {
        await setupNormalizedEvent('subscription.paused');
        expect(repo.updateSubscription).toHaveBeenCalledWith('sub-1', { status: 'PAUSED' });
      });

      it('should handle subscription.halted (from CF ON_HOLD / CARD_EXPIRED)', async () => {
        await setupNormalizedEvent('subscription.halted');
        expect(repo.updateSubscription).toHaveBeenCalledWith('sub-1', { status: 'PAST_DUE' });
      });

      it('should handle subscription.completed (from CF COMPLETED / EXPIRED)', async () => {
        await setupNormalizedEvent('subscription.completed');
        expect(repo.updateSubscription).toHaveBeenCalledWith('sub-1', { status: 'COMPLETED' });
      });

      it('should handle subscription.pending (from CF BANK_APPROVAL_PENDING)', async () => {
        await setupNormalizedEvent('subscription.pending');
        expect(repo.updateSubscription).toHaveBeenCalledWith('sub-1', {
          status: 'PENDING_PAYMENT',
        });
      });
    });
  });

  // ---------------------------------------------------------------------------
  // findAllSubscriptions
  // ---------------------------------------------------------------------------

  describe('findAllSubscriptions', () => {
    it('should return paginated subscriptions', async () => {
      const subs = [
        {
          id: 'sub-1',
          status: 'ACTIVE',
          organization: { id: 'org-1', name: 'Demo' },
          plan: { id: 'plan-1' },
        },
      ];
      repo.findAllSubscriptions.mockResolvedValue({ items: subs, totalCount: 1 });

      const result = await service.findAllSubscriptions({ first: 10 });

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].node.id).toBe('sub-1');
      expect(result.totalCount).toBe(1);
      expect(result.pageInfo.hasNextPage).toBe(false);
      expect(repo.findAllSubscriptions).toHaveBeenCalled();
    });

    it('should filter by status', async () => {
      repo.findAllSubscriptions.mockResolvedValue({ items: [], totalCount: 0 });

      await service.findAllSubscriptions({ filter: { status: SubscriptionStatus.ACTIVE } });

      expect(repo.findAllSubscriptions).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: { status: SubscriptionStatus.ACTIVE },
        }),
      );
    });

    it('should cap take at 100', async () => {
      repo.findAllSubscriptions.mockResolvedValue({ items: [], totalCount: 0 });

      const result = await service.findAllSubscriptions({ first: 500 });

      expect(result.pageInfo.hasNextPage).toBe(false);
    });

    it('should detect hasNextPage when more items exist', async () => {
      // Repo returns take+1 items to indicate there's a next page
      const items = Array.from({ length: 21 }, (_, i) => ({
        id: `sub-${i}`,
        status: 'ACTIVE',
      }));
      repo.findAllSubscriptions.mockResolvedValue({ items, totalCount: 50 });

      const result = await service.findAllSubscriptions({ first: 20 });

      expect(result.edges).toHaveLength(20);
      expect(result.pageInfo.hasNextPage).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // findInvoices
  // ---------------------------------------------------------------------------

  describe('findInvoices', () => {
    it('should return paginated invoices without organizationId (admin)', async () => {
      repo.findInvoices.mockResolvedValue({ items: [{ id: 'inv-1' }], totalCount: 1 });

      const result = await service.findInvoices({ first: 10 });

      expect(result.edges).toHaveLength(1);
      expect(repo.findInvoices).toHaveBeenCalledWith(expect.objectContaining({ first: 11 }));
    });

    it('should filter by organizationId when provided', async () => {
      repo.findInvoices.mockResolvedValue({ items: [], totalCount: 0 });

      await service.findInvoices({ organizationId: 'org-1', first: 10 });

      expect(repo.findInvoices).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-1' }),
      );
    });

    it('should detect hasNextPage for invoices', async () => {
      const items = Array.from({ length: 11 }, (_, i) => ({ id: `inv-${i}` }));
      repo.findInvoices.mockResolvedValue({ items, totalCount: 30 });

      const result = await service.findInvoices({ first: 10 });

      expect(result.edges).toHaveLength(10);
      expect(result.pageInfo.hasNextPage).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // findSubscription
  // ---------------------------------------------------------------------------

  describe('findSubscription', () => {
    it('should delegate to repo.findSubscriptionByOrg', async () => {
      const mockAbility = createMockAbility();
      repo.findSubscriptionByOrg.mockResolvedValue({ id: 'sub-1' });

      const result = await service.findSubscription('org-1', mockAbility);

      expect(repo.findSubscriptionByOrg).toHaveBeenCalledWith('org-1', mockAbility);
      expect(result).toEqual({ id: 'sub-1' });
    });
  });

  // ---------------------------------------------------------------------------
  // findPlan
  // ---------------------------------------------------------------------------

  describe('findPlan', () => {
    it('should delegate to repo.findPlanById', async () => {
      const mockAbility = createMockAbility();
      repo.findPlanById.mockResolvedValue({ id: 'plan-1', name: 'Pro' });

      const result = await service.findPlan('plan-1', mockAbility);

      expect(repo.findPlanById).toHaveBeenCalledWith('plan-1', mockAbility);
      expect(result).toEqual({ id: 'plan-1', name: 'Pro' });
    });
  });
});
