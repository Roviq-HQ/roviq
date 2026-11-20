import { ErrorCode } from '@roviq/common-types';
import { SYSTEM_USER_ID } from '@roviq/database';
import { PaymentMethod } from '@roviq/ee-billing-types';
import { requestContext } from '@roviq/request-context';
import { describe, expect, it, vi } from 'vitest';

import { PaymentService } from '../reseller/payment.service';

const TEST_CTX: import('@roviq/request-context').RequestContext = {
  userId: 'test-user-1',
  tenantId: 'tenant-1',
  resellerId: null,
  scope: 'institute',
  impersonatorId: null,
  correlationId: 'test',
};

function createMockPaymentRepo() {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findByInvoiceId: vi.fn(),
    findByTenantId: vi.fn(),
    findByGatewayOrderId: vi.fn(),
    findOrCreateByGatewayId: vi.fn(),
    findOpenGatewayPayment: vi.fn(),
    settleGatewayOrder: vi.fn(),
    findPayer: vi.fn(),
    findByUtrNumber: vi.fn(),
    findUnverified: vi.fn(),
    update: vi.fn(),
  };
}

function createMockInvoiceRepo() {
  return {
    findById: vi.fn(),
    nextInvoiceNumber: vi.fn(),
    create: vi.fn(),
    updateStatus: vi.fn(),
    findByResellerId: vi.fn(),
  };
}

function createMockInvoiceService() {
  return {
    markPaid: vi.fn(),
    markRefunded: vi.fn(),
    generateInvoice: vi.fn(),
  };
}

function createMockSubscriptionRepo() {
  return {
    findActiveByTenant: vi.fn(),
    update: vi.fn(),
  };
}

function createMockGatewayFactory() {
  return {
    create: vi.fn(),
  };
}

function createMockConfig() {
  return {
    getOrThrow: vi.fn().mockReturnValue('https://app.roviq.com/billing/return'),
    get: vi.fn(),
  };
}

function createMockEventBus() {
  return { emit: vi.fn() };
}

function createService(overrides: Record<string, unknown> = {}) {
  const paymentRepo = createMockPaymentRepo();
  const invoiceRepo = createMockInvoiceRepo();
  const invoiceService = createMockInvoiceService();
  const subscriptionRepo = createMockSubscriptionRepo();
  const gatewayFactory = createMockGatewayFactory();
  const config = createMockConfig();
  const eventBus = createMockEventBus();

  const svc = Object.create(PaymentService.prototype) as PaymentService;
  Object.assign(svc, {
    paymentRepo,
    invoiceRepo,
    invoiceService,
    subscriptionRepo,
    gatewayFactory,
    config,
    eventBus,
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  });

  return {
    service: svc,
    paymentRepo,
    invoiceRepo,
    invoiceService,
    subscriptionRepo,
    gatewayFactory,
    config,
    eventBus,
  };
}

describe('PaymentService', () => {
  describe('recordManualPayment', () => {
    it('should create payment, update invoice paidAmount, and return the updated invoice', () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, paymentRepo, invoiceRepo, invoiceService } = createService();
        invoiceRepo.findById.mockResolvedValue({
          id: 'inv-1',
          tenantId: 'tenant-1',
          totalAmount: 118000n,
          paidAmount: 0n,
          currency: 'INR',
          status: 'SENT',
        });
        paymentRepo.create.mockImplementation((_rid: string, data: Record<string, unknown>) =>
          Promise.resolve({ id: 'pay-1', ...data }),
        );
        invoiceService.markPaid.mockResolvedValue({
          id: 'inv-1',
          tenantId: 'tenant-1',
          totalAmount: 118000n,
          paidAmount: 118000n,
          currency: 'INR',
          status: 'PAID',
        });

        const result = await service.recordManualPayment('reseller-1', 'inv-1', {
          method: PaymentMethod.CASH,
          amountPaise: 118000n,
          collectedById: 'member-1',
          collectionDate: '2026-03-24',
        });

        expect(paymentRepo.create).toHaveBeenCalledWith(
          'reseller-1',
          expect.objectContaining({
            method: 'CASH',
            amountPaise: 118000n,
            collectedById: 'member-1',
            collectionDate: '2026-03-24',
            status: 'SUCCEEDED',
          }),
        );
        expect(invoiceService.markPaid).toHaveBeenCalledWith('reseller-1', 'inv-1', 118000n);
        // Resolver declares @Mutation(() => InvoiceModel), so the service must
        // return the invoice (with PAID status), not the Payment row.
        expect(result?.id).toBe('inv-1');
        expect(result?.status).toBe('PAID');
      }));

    it('should reject payment on already paid invoice', () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, invoiceRepo } = createService();
        invoiceRepo.findById.mockResolvedValue({ status: 'PAID' });

        await expect(
          service.recordManualPayment('reseller-1', 'inv-1', {
            method: PaymentMethod.CASH,
            amountPaise: 50000n,
          }),
        ).rejects.toThrow();
      }));
  });

  describe('issueRefund', () => {
    it('should refund and update payment status', () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, paymentRepo, invoiceService } = createService();
        paymentRepo.findById.mockResolvedValue({
          id: 'pay-1',
          invoiceId: 'inv-1',
          status: 'SUCCEEDED',
          amountPaise: 118000n,
          refundedAmountPaise: 0n,
          gatewayPaymentId: null,
          gatewayProvider: null,
        });
        paymentRepo.update.mockImplementation(
          (_rid: string, _id: string, data: Record<string, unknown>) =>
            Promise.resolve({ id: 'pay-1', ...data }),
        );

        await service.issueRefund('reseller-1', 'pay-1', {
          amountPaise: 50000n,
          reason: 'Partial refund',
        });

        expect(paymentRepo.update).toHaveBeenCalledWith(
          'reseller-1',
          'pay-1',
          expect.objectContaining({
            status: 'PARTIALLY_REFUNDED',
            refundedAmountPaise: 50000n,
            refundReason: 'Partial refund',
          }),
        );
        expect(invoiceService.markRefunded).toHaveBeenCalledWith('reseller-1', 'inv-1', 50000n);
      }));

    it('should mark REFUNDED for full refund', () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, paymentRepo } = createService();
        paymentRepo.findById.mockResolvedValue({
          id: 'pay-1',
          invoiceId: 'inv-1',
          status: 'SUCCEEDED',
          amountPaise: 100000n,
          refundedAmountPaise: 0n,
          gatewayPaymentId: null,
          gatewayProvider: null,
        });
        paymentRepo.update.mockResolvedValue({});

        await service.issueRefund('reseller-1', 'pay-1', {
          amountPaise: 100000n,
        });

        expect(paymentRepo.update).toHaveBeenCalledWith(
          'reseller-1',
          'pay-1',
          expect.objectContaining({ status: 'REFUNDED' }),
        );
      }));

    it('should throw REFUND_EXCEEDS_PAID when refund > paid', () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, paymentRepo } = createService();
        paymentRepo.findById.mockResolvedValue({
          id: 'pay-1',
          status: 'SUCCEEDED',
          amountPaise: 100000n,
          refundedAmountPaise: 80000n,
        });

        await expect(
          service.issueRefund('reseller-1', 'pay-1', { amountPaise: 30000n }),
        ).rejects.toThrow();
      }));

    it('should call gateway refund for gateway payments', () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, paymentRepo, gatewayFactory } = createService();
        const mockGateway = {
          refundOrder: vi.fn().mockResolvedValue({ gatewayRefundId: 'rfnd_123' }),
        };
        gatewayFactory.create.mockResolvedValue(mockGateway);
        paymentRepo.findById.mockResolvedValue({
          id: 'pay-1',
          invoiceId: 'inv-1',
          status: 'SUCCEEDED',
          amountPaise: 100000n,
          refundedAmountPaise: 0n,
          gatewayPaymentId: 'pay_gw_123',
          gatewayProvider: 'RAZORPAY',
        });
        paymentRepo.update.mockResolvedValue({});

        await service.issueRefund('reseller-1', 'pay-1', {
          amountPaise: 50000n,
          reason: 'Gateway refund',
        });

        expect(gatewayFactory.create).toHaveBeenCalledWith('reseller-1', 'RAZORPAY');
        expect(mockGateway.refundOrder).toHaveBeenCalledWith({
          gatewayPaymentId: 'pay_gw_123',
          amountPaise: 50000n,
          reason: 'Gateway refund',
        });
        expect(paymentRepo.update).toHaveBeenCalledWith(
          'reseller-1',
          'pay-1',
          expect.objectContaining({ refundGatewayId: 'rfnd_123' }),
        );
      }));
  });

  describe('initiatePayment', () => {
    const CALLER = { resellerId: 'reseller-1', tenantId: 'tenant-1' };
    const INVOICE = {
      id: 'inv-1',
      tenantId: 'tenant-1',
      totalAmount: 118000n,
      paidAmount: 18000n,
      currency: 'INR',
      status: 'SENT',
    };
    const PAYER = {
      name: { en: 'Saraswati Vidya Mandir' },
      contact: {
        phones: [
          {
            countryCode: '+91',
            number: '9000000001',
            isPrimary: false,
            isWhatsappEnabled: false,
            label: 'Office',
          },
          {
            countryCode: '+91',
            number: '9000000002',
            isPrimary: true,
            isWhatsappEnabled: true,
            label: 'Accounts',
          },
        ],
        emails: [{ address: 'accounts@svm.example', isPrimary: true, label: 'Accounts' }],
      },
    };
    const ORDER_INPUT = {
      invoiceId: 'inv-1',
      amountPaise: 100000n,
      currency: 'INR',
      customer: {
        name: 'Saraswati Vidya Mandir',
        email: 'accounts@svm.example',
        phone: '9000000002',
      },
      returnUrl: 'https://app.roviq.com/billing/invoices/inv-1?order_id={order_id}',
    };
    const CHECKOUT = {
      gatewayOrderId: 'order_123',
      gatewayProvider: 'RAZORPAY',
      checkoutPayload: { key: 'rzp_test_123', order_id: 'order_123' },
    };

    function setup(gateway: { createOrder?: unknown; resumeOrder?: unknown }) {
      const ctx = createService();
      ctx.invoiceRepo.findById.mockResolvedValue(INVOICE);
      ctx.config.getOrThrow.mockReturnValue('https://app.roviq.com/billing/subscriptions');
      ctx.paymentRepo.findPayer.mockResolvedValue(PAYER);
      ctx.paymentRepo.findOpenGatewayPayment.mockResolvedValue(null);
      ctx.gatewayFactory.create.mockResolvedValue(gateway);
      ctx.paymentRepo.create.mockImplementation((_rid: string, data: Record<string, unknown>) =>
        Promise.resolve({ id: 'pay-1', ...data }),
      );
      return ctx;
    }

    it("should open a gateway order for the amount due with the institute's contact", () =>
      requestContext.run(TEST_CTX, async () => {
        const createOrder = vi.fn().mockResolvedValue(CHECKOUT);
        const { service, paymentRepo } = setup({ createOrder });

        const result = await service.initiatePayment(CALLER, 'inv-1');

        expect(createOrder).toHaveBeenCalledWith(ORDER_INPUT);
        expect(paymentRepo.create).toHaveBeenCalledWith('reseller-1', {
          invoiceId: 'inv-1',
          tenantId: 'tenant-1',
          resellerId: 'reseller-1',
          status: 'PENDING',
          method: 'RAZORPAY',
          amountPaise: 100000n,
          currency: 'INR',
          gatewayProvider: 'RAZORPAY',
          gatewayOrderId: 'order_123',
          createdBy: 'test-user-1',
          updatedBy: 'test-user-1',
        });
        expect(result).toEqual({ paymentId: 'pay-1', ...CHECKOUT });
      }));

    it('should reopen the open order of an earlier click instead of adding a payment', () =>
      requestContext.run(TEST_CTX, async () => {
        const createOrder = vi.fn();
        const resumeOrder = vi.fn().mockResolvedValue({ state: 'OPEN', checkout: CHECKOUT });
        const { service, paymentRepo } = setup({ createOrder, resumeOrder });
        paymentRepo.findOpenGatewayPayment.mockResolvedValue({
          id: 'pay-0',
          gatewayOrderId: 'order_123',
        });

        const result = await service.initiatePayment(CALLER, 'inv-1');

        expect(resumeOrder).toHaveBeenCalledWith('order_123', ORDER_INPUT);
        expect(createOrder).not.toHaveBeenCalled();
        expect(paymentRepo.create).not.toHaveBeenCalled();
        expect(result).toEqual({ paymentId: 'pay-0', ...CHECKOUT });
      }));

    it('should close an expired order and open a new one', () =>
      requestContext.run(TEST_CTX, async () => {
        const createOrder = vi.fn().mockResolvedValue(CHECKOUT);
        const resumeOrder = vi.fn().mockResolvedValue({ state: 'CLOSED' });
        const { service, paymentRepo } = setup({ createOrder, resumeOrder });
        paymentRepo.findOpenGatewayPayment.mockResolvedValue({
          id: 'pay-0',
          gatewayOrderId: 'order_old',
        });

        const result = await service.initiatePayment(CALLER, 'inv-1');

        expect(paymentRepo.update).toHaveBeenCalledWith('reseller-1', 'pay-0', {
          status: 'FAILED',
          failedAt: expect.any(Date),
          failureReason: 'Gateway order expired before payment',
        });
        expect(result.paymentId).toBe('pay-1');
      }));

    it('should refuse a new order while a captured payment is being confirmed', () =>
      requestContext.run(TEST_CTX, async () => {
        const createOrder = vi.fn();
        const resumeOrder = vi.fn().mockResolvedValue({ state: 'PAID' });
        const { service, paymentRepo } = setup({ createOrder, resumeOrder });
        paymentRepo.findOpenGatewayPayment.mockResolvedValue({
          id: 'pay-0',
          gatewayOrderId: 'order_123',
        });

        await expect(service.initiatePayment(CALLER, 'inv-1')).rejects.toMatchObject({
          code: ErrorCode.INVOICE_ALREADY_PAID,
        });
        expect(createOrder).not.toHaveBeenCalled();
      }));

    it("should treat another institute's invoice as not found", () =>
      requestContext.run(TEST_CTX, async () => {
        const createOrder = vi.fn();
        const { service, invoiceRepo } = setup({ createOrder });
        invoiceRepo.findById.mockResolvedValue({ ...INVOICE, tenantId: 'tenant-2' });

        await expect(service.initiatePayment(CALLER, 'inv-1')).rejects.toMatchObject({
          code: ErrorCode.INVOICE_NOT_FOUND,
        });
        expect(createOrder).not.toHaveBeenCalled();
      }));

    it('should reject non-payable invoices', () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, invoiceRepo } = setup({ createOrder: vi.fn() });
        invoiceRepo.findById.mockResolvedValue({ ...INVOICE, status: 'PAID' });

        await expect(service.initiatePayment(CALLER, 'inv-1')).rejects.toMatchObject({
          code: ErrorCode.INVOICE_NOT_PAYABLE,
        });
      }));
  });

  describe('verifyPayment', () => {
    const CALLER = { resellerId: 'reseller-1', tenantId: 'tenant-1' };
    const INPUT = {
      gatewayOrderId: 'order_123',
      gatewayPaymentId: 'pay_gw_123',
      signature: 'sig_123',
    };
    const SETTLED = {
      id: 'pay-1',
      status: 'SUCCEEDED',
      invoiceId: 'inv-1',
      tenantId: 'tenant-1',
      amountPaise: 118000n,
    };

    it("should settle the institute's pending payment and mark the invoice paid", () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, paymentRepo, gatewayFactory, invoiceService } = createService();
        gatewayFactory.create.mockResolvedValue({
          verifyPayment: vi.fn().mockResolvedValue({ gatewayPaymentId: 'pay_gw_123' }),
        });
        paymentRepo.settleGatewayOrder.mockResolvedValue({ payment: SETTLED, settled: true });

        const result = await service.verifyPayment(CALLER, INPUT);

        expect(paymentRepo.settleGatewayOrder).toHaveBeenCalledWith('reseller-1', {
          gatewayOrderId: 'order_123',
          gatewayPaymentId: 'pay_gw_123',
          tenantId: 'tenant-1',
          actorId: 'test-user-1',
        });
        expect(invoiceService.markPaid).toHaveBeenCalledWith('reseller-1', 'inv-1', 118000n);
        expect(result).toBe(SETTLED);
      }));

    it('should not mark the invoice paid again when the webhook settled it first', () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, paymentRepo, gatewayFactory, invoiceService, eventBus } = createService();
        gatewayFactory.create.mockResolvedValue({
          verifyPayment: vi.fn().mockResolvedValue({ gatewayPaymentId: 'pay_gw_123' }),
        });
        paymentRepo.settleGatewayOrder.mockResolvedValue({ payment: SETTLED, settled: false });

        const result = await service.verifyPayment(CALLER, INPUT);

        expect(result).toBe(SETTLED);
        expect(invoiceService.markPaid).not.toHaveBeenCalled();
        expect(eventBus.emit).not.toHaveBeenCalled();
      }));

    it('should throw when the gateway does not confirm the payment', () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, gatewayFactory, paymentRepo } = createService();
        gatewayFactory.create.mockResolvedValue({
          verifyPayment: vi.fn().mockResolvedValue(null),
        });

        await expect(
          service.verifyPayment(CALLER, { ...INPUT, signature: 'bad_sig' }),
        ).rejects.toMatchObject({ code: ErrorCode.PAYMENT_VERIFICATION_FAILED });
        expect(paymentRepo.settleGatewayOrder).not.toHaveBeenCalled();
      }));

    it("should refuse another institute's order of the same reseller as not found", () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, paymentRepo, gatewayFactory, invoiceService } = createService();
        gatewayFactory.create.mockResolvedValue({
          verifyPayment: vi.fn().mockResolvedValue({ gatewayPaymentId: 'pay_gw_456' }),
        });
        paymentRepo.settleGatewayOrder.mockResolvedValue(null);

        await expect(
          service.verifyPayment(CALLER, { ...INPUT, gatewayOrderId: 'order_456' }),
        ).rejects.toMatchObject({ code: ErrorCode.PAYMENT_NOT_FOUND });
        expect(invoiceService.markPaid).not.toHaveBeenCalled();
      }));
  });

  describe('handleWebhookPayment', () => {
    const WEBHOOK = {
      gatewayPaymentId: 'pay_gw_123',
      invoiceId: 'inv-1',
      tenantId: 'tenant-1',
      method: PaymentMethod.RAZORPAY,
      amountPaise: 118000n,
      gatewayProvider: 'RAZORPAY',
    };
    const PAYMENT = {
      id: 'pay-1',
      invoiceId: 'inv-1',
      tenantId: 'tenant-1',
      amountPaise: 118000n,
    };

    it("should settle the order's pending payment instead of adding a second one", () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, paymentRepo, invoiceService } = createService();
        paymentRepo.settleGatewayOrder.mockResolvedValue({ payment: PAYMENT, settled: true });

        await service.handleWebhookPayment('reseller-1', {
          ...WEBHOOK,
          gatewayOrderId: 'order_123',
          gatewayResponse: { event: 'payment.captured' },
        });

        expect(paymentRepo.settleGatewayOrder).toHaveBeenCalledWith('reseller-1', {
          gatewayOrderId: 'order_123',
          gatewayPaymentId: 'pay_gw_123',
          gatewayResponse: { event: 'payment.captured' },
          actorId: 'test-user-1',
        });
        expect(paymentRepo.findOrCreateByGatewayId).not.toHaveBeenCalled();
        expect(invoiceService.markPaid).toHaveBeenCalledWith('reseller-1', 'inv-1', 118000n);
      }));

    it('should record the system user as actor when the webhook has no user', () =>
      requestContext.run({ ...TEST_CTX, userId: '' }, async () => {
        const { service, paymentRepo } = createService();
        paymentRepo.settleGatewayOrder.mockResolvedValue({ payment: PAYMENT, settled: true });

        await service.handleWebhookPayment('reseller-1', {
          ...WEBHOOK,
          gatewayOrderId: 'order_123',
        });

        expect(paymentRepo.settleGatewayOrder).toHaveBeenCalledWith('reseller-1', {
          gatewayOrderId: 'order_123',
          gatewayPaymentId: 'pay_gw_123',
          gatewayResponse: undefined,
          actorId: SYSTEM_USER_ID,
        });
      }));

    it('should not mark the invoice paid again after the browser verified it', () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, paymentRepo, invoiceService } = createService();
        paymentRepo.settleGatewayOrder.mockResolvedValue({ payment: PAYMENT, settled: false });

        await service.handleWebhookPayment('reseller-1', {
          ...WEBHOOK,
          gatewayOrderId: 'order_123',
        });

        expect(paymentRepo.findOrCreateByGatewayId).not.toHaveBeenCalled();
        expect(invoiceService.markPaid).not.toHaveBeenCalled();
      }));

    it('should be idempotent — skip if payment already exists', () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, paymentRepo, invoiceService } = createService();
        paymentRepo.findOrCreateByGatewayId.mockResolvedValue({
          payment: PAYMENT,
          created: false,
        });

        await service.handleWebhookPayment('reseller-1', WEBHOOK);

        expect(invoiceService.markPaid).not.toHaveBeenCalled();
      }));

    it('should create payment and update invoice when the order has no pending payment', () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, paymentRepo, invoiceService } = createService();
        paymentRepo.settleGatewayOrder.mockResolvedValue(null);
        paymentRepo.findOrCreateByGatewayId.mockResolvedValue({
          payment: PAYMENT,
          created: true,
        });

        await service.handleWebhookPayment('reseller-1', {
          ...WEBHOOK,
          gatewayOrderId: 'order_unknown',
        });

        expect(invoiceService.markPaid).toHaveBeenCalledWith('reseller-1', 'inv-1', 118000n);
      }));
  });

  describe('submitUpiProof', () => {
    it('should create SUCCEEDED payment with PENDING_VERIFICATION', () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, paymentRepo, invoiceRepo, invoiceService, subscriptionRepo } =
          createService();
        invoiceRepo.findById.mockResolvedValue({
          id: 'inv-1',
          tenantId: 'tenant-1',
          totalAmount: 118000n,
          paidAmount: 0n,
          currency: 'INR',
          status: 'SENT',
        });
        paymentRepo.findByUtrNumber.mockResolvedValue(null);
        paymentRepo.create.mockImplementation((_rid: string, data: Record<string, unknown>) =>
          Promise.resolve({ id: 'pay-1', ...data }),
        );
        subscriptionRepo.findActiveByTenant.mockResolvedValue(null);

        const result = await service.submitUpiProof(
          'reseller-1',
          'inv-1',
          '123456789012',
          'member-1',
        );

        expect(paymentRepo.create).toHaveBeenCalledWith(
          'reseller-1',
          expect.objectContaining({
            method: 'UPI_P2P',
            status: 'SUCCEEDED',
            verificationStatus: 'PENDING_VERIFICATION',
            utrNumber: '123456789012',
            amountPaise: 118000n,
          }),
        );
        expect(invoiceService.markPaid).toHaveBeenCalledWith('reseller-1', 'inv-1', 118000n);
        expect(result.id).toBe('pay-1');
      }));

    it('should reject invalid UTR format', () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, invoiceRepo } = createService();
        invoiceRepo.findById.mockResolvedValue({
          status: 'SENT',
          totalAmount: 100000n,
          paidAmount: 0n,
        });

        await expect(
          service.submitUpiProof('reseller-1', 'inv-1', 'INVALID', 'member-1'),
        ).rejects.toThrow();
      }));

    it('should reject duplicate UTR', () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, invoiceRepo, paymentRepo } = createService();
        invoiceRepo.findById.mockResolvedValue({
          status: 'SENT',
          totalAmount: 100000n,
          paidAmount: 0n,
        });
        paymentRepo.findByUtrNumber.mockResolvedValue({ id: 'existing-pay' });

        await expect(
          service.submitUpiProof('reseller-1', 'inv-1', '123456789012', 'member-1'),
        ).rejects.toThrow();
      }));

    it('should reactivate PAST_DUE subscription (trust-first)', () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, paymentRepo, invoiceRepo, subscriptionRepo } = createService();
        invoiceRepo.findById.mockResolvedValue({
          id: 'inv-1',
          tenantId: 'tenant-1',
          totalAmount: 118000n,
          paidAmount: 0n,
          currency: 'INR',
          status: 'OVERDUE',
        });
        paymentRepo.findByUtrNumber.mockResolvedValue(null);
        paymentRepo.create.mockImplementation((_rid: string, data: Record<string, unknown>) =>
          Promise.resolve({ id: 'pay-1', ...data }),
        );
        subscriptionRepo.findActiveByTenant.mockResolvedValue({
          id: 'sub-1',
          status: 'PAST_DUE',
        });

        await service.submitUpiProof('reseller-1', 'inv-1', '123456789012', 'member-1');

        expect(subscriptionRepo.update).toHaveBeenCalledWith('reseller-1', 'sub-1', {
          status: 'ACTIVE',
        });
      }));
  });

  describe('verifyUpiPayment', () => {
    it('should set VERIFIED with timestamp and verifier', () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, paymentRepo } = createService();
        paymentRepo.findById.mockResolvedValue({
          id: 'pay-1',
          verificationStatus: 'PENDING_VERIFICATION',
        });
        paymentRepo.update.mockResolvedValue({ id: 'pay-1', verificationStatus: 'VERIFIED' });

        await service.verifyUpiPayment('reseller-1', 'pay-1', 'member-1');

        expect(paymentRepo.update).toHaveBeenCalledWith(
          'reseller-1',
          'pay-1',
          expect.objectContaining({
            verificationStatus: 'VERIFIED',
            verifiedById: 'member-1',
          }),
        );
      }));

    it('should reject if not PENDING_VERIFICATION', () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, paymentRepo } = createService();
        paymentRepo.findById.mockResolvedValue({
          id: 'pay-1',
          verificationStatus: 'VERIFIED',
        });

        await expect(service.verifyUpiPayment('reseller-1', 'pay-1', 'member-1')).rejects.toThrow();
      }));
  });

  describe('rejectUpiPayment', () => {
    it('should reverse payment, invoice, and subscription', () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, paymentRepo, invoiceRepo, invoiceService, subscriptionRepo } =
          createService();
        paymentRepo.findById.mockResolvedValue({
          id: 'pay-1',
          invoiceId: 'inv-1',
          tenantId: 'tenant-1',
          amountPaise: 118000n,
          verificationStatus: 'PENDING_VERIFICATION',
        });
        // After reversal, invoice is no longer PAID
        invoiceRepo.findById.mockResolvedValue({ id: 'inv-1', status: 'SENT' });
        subscriptionRepo.findActiveByTenant.mockResolvedValue({ id: 'sub-1', status: 'ACTIVE' });
        paymentRepo.update.mockResolvedValue({});

        await service.rejectUpiPayment('reseller-1', 'pay-1', 'UTR not found in bank');

        // 1. Invoice refunded
        expect(invoiceService.markRefunded).toHaveBeenCalledWith('reseller-1', 'inv-1', 118000n);
        // 2. Subscription reverted to PAST_DUE
        expect(subscriptionRepo.update).toHaveBeenCalledWith('reseller-1', 'sub-1', {
          status: 'PAST_DUE',
        });
        // 3. Payment marked FAILED + REJECTED
        expect(paymentRepo.update).toHaveBeenCalledWith(
          'reseller-1',
          'pay-1',
          expect.objectContaining({
            status: 'FAILED',
            verificationStatus: 'REJECTED',
            failureReason: 'UTR not found in bank',
          }),
        );
      }));
  });

  describe('findUnverifiedPayments', () => {
    it('should delegate to repository', async () => {
      const { service, paymentRepo } = createService();
      paymentRepo.findUnverified.mockResolvedValue({ nodes: [], totalCount: 0 });

      await service.findUnverifiedPayments('reseller-1', 10);

      expect(paymentRepo.findUnverified).toHaveBeenCalledWith('reseller-1', {
        first: 10,
        after: undefined,
      });
    });
  });
});
