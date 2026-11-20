import { BusinessException, ErrorCode } from '@roviq/common-types';
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
    recordGatewayPayment: vi.fn(),
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

  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const svc = Object.create(PaymentService.prototype) as PaymentService;
  Object.assign(svc, {
    paymentRepo,
    invoiceRepo,
    invoiceService,
    subscriptionRepo,
    gatewayFactory,
    config,
    eventBus,
    logger,
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
    logger,
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
    const NOW = new Date('2026-11-20T10:00:00.000Z');
    const INVOICE = {
      id: 'inv-1',
      tenantId: 'tenant-1',
      subscriptionId: 'sub-1',
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
      owner: { invoiceId: 'inv-1', tenantId: 'tenant-1' },
    };
    const CHECKOUT = {
      gatewayOrderId: 'order_123',
      gatewayProvider: 'RAZORPAY',
      checkoutPayload: { key: 'rzp_test_123', order_id: 'order_123' },
    };
    const OPEN_ROW = { id: 'pay-0', gatewayOrderId: 'order_old', gatewayProvider: 'CASHFREE' };

    function setup(gateways: {
      current: Record<string, unknown>;
      old?: Record<string, unknown> | Error;
    }) {
      const ctx = createService();
      ctx.invoiceRepo.findById.mockResolvedValue(INVOICE);
      ctx.config.getOrThrow.mockReturnValue('https://app.roviq.com/billing/subscriptions');
      ctx.paymentRepo.findPayer.mockResolvedValue(PAYER);
      ctx.paymentRepo.findOpenGatewayPayment.mockResolvedValue(null);
      ctx.gatewayFactory.create.mockImplementation((_rid: string, provider?: string) => {
        if (provider === 'CASHFREE') {
          return gateways.old instanceof Error
            ? Promise.reject(gateways.old)
            : Promise.resolve(gateways.old);
        }
        return Promise.resolve(gateways.current);
      });
      ctx.paymentRepo.create.mockImplementation((_rid: string, data: Record<string, unknown>) =>
        Promise.resolve({ id: 'pay-1', ...data }),
      );
      return ctx;
    }

    it("should open a gateway order for the amount due with the institute's contact", () =>
      requestContext.run(TEST_CTX, async () => {
        const createOrder = vi.fn().mockResolvedValue(CHECKOUT);
        const { service, paymentRepo } = setup({ current: { createOrder } });

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

    it('should reopen the open order on the gateway it was made on', () =>
      requestContext.run(TEST_CTX, async () => {
        const createOrder = vi.fn();
        const resumeOrder = vi.fn().mockResolvedValue({ state: 'OPEN', checkout: CHECKOUT });
        const { service, paymentRepo, gatewayFactory } = setup({
          current: { createOrder },
          old: { resumeOrder },
        });
        paymentRepo.findOpenGatewayPayment.mockResolvedValue(OPEN_ROW);

        const result = await service.initiatePayment(CALLER, 'inv-1');

        expect(gatewayFactory.create).toHaveBeenCalledWith('reseller-1', 'CASHFREE');
        expect(resumeOrder).toHaveBeenCalledWith('order_old', ORDER_INPUT);
        expect(createOrder).not.toHaveBeenCalled();
        expect(paymentRepo.create).not.toHaveBeenCalled();
        expect(result).toEqual({ paymentId: 'pay-0', ...CHECKOUT });
      }));

    it('should close an expired order and open a new one', () =>
      requestContext.run(TEST_CTX, async () => {
        vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
        try {
          const createOrder = vi.fn().mockResolvedValue(CHECKOUT);
          const resumeOrder = vi.fn().mockResolvedValue({ state: 'CLOSED' });
          const { service, paymentRepo } = setup({
            current: { createOrder },
            old: { resumeOrder },
          });
          paymentRepo.findOpenGatewayPayment.mockResolvedValue(OPEN_ROW);

          const result = await service.initiatePayment(CALLER, 'inv-1');

          expect(paymentRepo.update).toHaveBeenCalledWith('reseller-1', 'pay-0', {
            status: 'FAILED',
            failedAt: NOW,
            failureReason: 'Gateway order expired before payment',
          });
          expect(result.paymentId).toBe('pay-1');
        } finally {
          vi.useRealTimers();
        }
      }));

    it('should replace an open order whose gateway the reseller no longer has', () =>
      requestContext.run(TEST_CTX, async () => {
        vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
        try {
          const createOrder = vi.fn().mockResolvedValue(CHECKOUT);
          const { service, paymentRepo } = setup({
            current: { createOrder },
            old: new BusinessException(ErrorCode.PAYMENT_GATEWAY_NOT_CONFIGURED, 'gone'),
          });
          paymentRepo.findOpenGatewayPayment.mockResolvedValue(OPEN_ROW);

          const result = await service.initiatePayment(CALLER, 'inv-1');

          expect(paymentRepo.update).toHaveBeenCalledWith('reseller-1', 'pay-0', {
            status: 'FAILED',
            failedAt: NOW,
            failureReason: 'Gateway order expired before payment',
          });
          expect(result).toEqual({ paymentId: 'pay-1', ...CHECKOUT });
        } finally {
          vi.useRealTimers();
        }
      }));

    it('should record an earlier order the gateway reports as paid, then refuse a new one', () =>
      requestContext.run(TEST_CTX, async () => {
        const createOrder = vi.fn();
        const resumeOrder = vi.fn().mockResolvedValue({ state: 'PAID' });
        const findPaidPayment = vi.fn().mockResolvedValue({ gatewayPaymentId: 'cf_pay_9' });
        const { service, paymentRepo, invoiceRepo, eventBus } = setup({
          current: { createOrder },
          old: { resumeOrder, findPaidPayment },
        });
        paymentRepo.findOpenGatewayPayment.mockResolvedValue(OPEN_ROW);
        const paidInvoice = { ...INVOICE, paidAmount: 118000n, status: 'PAID' };
        paymentRepo.settleGatewayOrder.mockResolvedValue({
          payment: { id: 'pay-0', invoiceId: 'inv-1', tenantId: 'tenant-1' },
          credit: {
            invoice: paidInvoice,
            becamePaid: true,
            statusBefore: 'SENT',
            overpaidPaise: 0n,
          },
          settled: true,
        });
        invoiceRepo.findById.mockResolvedValueOnce(INVOICE).mockResolvedValueOnce(paidInvoice);

        await expect(service.initiatePayment(CALLER, 'inv-1')).rejects.toMatchObject({
          code: ErrorCode.INVOICE_ALREADY_PAID,
        });

        expect(paymentRepo.settleGatewayOrder).toHaveBeenCalledWith('reseller-1', {
          gatewayOrderId: 'order_old',
          gatewayPaymentId: 'cf_pay_9',
          tenantId: 'tenant-1',
          actorId: 'test-user-1',
        });
        expect(eventBus.emit).toHaveBeenCalledWith('BILLING.invoice.paid', {
          invoiceId: 'inv-1',
          tenantId: 'tenant-1',
          subscriptionId: 'sub-1',
          totalAmount: '118000',
        });
        expect(createOrder).not.toHaveBeenCalled();
      }));

    it('should say the payment is being confirmed when the gateway has not exposed it yet', () =>
      requestContext.run(TEST_CTX, async () => {
        const resumeOrder = vi.fn().mockResolvedValue({ state: 'PAID' });
        const findPaidPayment = vi.fn().mockResolvedValue(null);
        const { service, paymentRepo } = setup({
          current: { createOrder: vi.fn() },
          old: { resumeOrder, findPaidPayment },
        });
        paymentRepo.findOpenGatewayPayment.mockResolvedValue(OPEN_ROW);

        await expect(service.initiatePayment(CALLER, 'inv-1')).rejects.toMatchObject({
          code: ErrorCode.INVOICE_ALREADY_PAID,
        });
        expect(paymentRepo.settleGatewayOrder).not.toHaveBeenCalled();
      }));

    it("should treat another institute's invoice as not found", () =>
      requestContext.run(TEST_CTX, async () => {
        const createOrder = vi.fn();
        const { service, invoiceRepo } = setup({ current: { createOrder } });
        invoiceRepo.findById.mockResolvedValue({ ...INVOICE, tenantId: 'tenant-2' });

        await expect(service.initiatePayment(CALLER, 'inv-1')).rejects.toMatchObject({
          code: ErrorCode.INVOICE_NOT_FOUND,
        });
        expect(createOrder).not.toHaveBeenCalled();
      }));

    it('should refuse a draft invoice, which is not issued yet', () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, invoiceRepo } = setup({ current: { createOrder: vi.fn() } });
        invoiceRepo.findById.mockResolvedValue({ ...INVOICE, status: 'DRAFT' });

        await expect(service.initiatePayment(CALLER, 'inv-1')).rejects.toMatchObject({
          code: ErrorCode.INVOICE_NOT_PAYABLE,
        });
      }));

    it('should answer INVOICE_ALREADY_PAID for a paid invoice', () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, invoiceRepo } = setup({ current: { createOrder: vi.fn() } });
        invoiceRepo.findById.mockResolvedValue({ ...INVOICE, status: 'PAID' });

        await expect(service.initiatePayment(CALLER, 'inv-1')).rejects.toMatchObject({
          code: ErrorCode.INVOICE_ALREADY_PAID,
        });
      }));

    it('should ask for the institute contact when it has no phone number', () =>
      requestContext.run(TEST_CTX, async () => {
        const createOrder = vi.fn();
        const { service, paymentRepo } = setup({ current: { createOrder } });
        paymentRepo.findPayer.mockResolvedValue({
          ...PAYER,
          contact: { ...PAYER.contact, phones: [] },
        });

        await expect(service.initiatePayment(CALLER, 'inv-1')).rejects.toMatchObject({
          code: ErrorCode.PAYER_CONTACT_MISSING,
        });
        expect(createOrder).not.toHaveBeenCalled();
      }));
  });

  describe('verifyPayment', () => {
    const CALLER = { resellerId: 'reseller-1', tenantId: 'tenant-1' };
    const INPUT = {
      gatewayOrderId: 'order_123',
      gatewayPaymentId: 'pay_gw_123',
      signature: 'sig_123',
    };
    const ROW = { id: 'pay-1', tenantId: 'tenant-1', gatewayProvider: 'RAZORPAY' };
    const SETTLED = {
      payment: { id: 'pay-1', status: 'SUCCEEDED', invoiceId: 'inv-1', tenantId: 'tenant-1' },
      credit: {
        invoice: {
          id: 'inv-1',
          tenantId: 'tenant-1',
          subscriptionId: 'sub-1',
          status: 'PAID',
          totalAmount: 118000n,
        },
        becamePaid: true,
        statusBefore: 'SENT',
        overpaidPaise: 0n,
      },
    };

    function setup(verifyPayment: ReturnType<typeof vi.fn>) {
      const ctx = createService();
      ctx.paymentRepo.findByGatewayOrderId.mockResolvedValue([ROW]);
      ctx.gatewayFactory.create.mockResolvedValue({ verifyPayment });
      return ctx;
    }

    it("should settle the institute's payment on the order's own gateway", () =>
      requestContext.run(TEST_CTX, async () => {
        const verify = vi.fn().mockResolvedValue({ gatewayPaymentId: 'pay_gw_123' });
        const { service, paymentRepo, gatewayFactory, eventBus } = setup(verify);
        paymentRepo.settleGatewayOrder.mockResolvedValue({ ...SETTLED, settled: true });

        const result = await service.verifyPayment(CALLER, INPUT);

        expect(gatewayFactory.create).toHaveBeenCalledWith('reseller-1', 'RAZORPAY');
        expect(paymentRepo.settleGatewayOrder).toHaveBeenCalledWith('reseller-1', {
          gatewayOrderId: 'order_123',
          gatewayPaymentId: 'pay_gw_123',
          tenantId: 'tenant-1',
          actorId: 'test-user-1',
        });
        expect(eventBus.emit).toHaveBeenCalledWith('BILLING.payment.succeeded', {
          paymentId: 'pay-1',
          invoiceId: 'inv-1',
          tenantId: 'tenant-1',
          resellerId: 'reseller-1',
        });
        expect(result).toBe(SETTLED.payment);
      }));

    it('should not announce the payment again when the webhook settled it first', () =>
      requestContext.run(TEST_CTX, async () => {
        const verify = vi.fn().mockResolvedValue({ gatewayPaymentId: 'pay_gw_123' });
        const { service, paymentRepo, eventBus } = setup(verify);
        paymentRepo.settleGatewayOrder.mockResolvedValue({
          payment: SETTLED.payment,
          credit: null,
          settled: false,
        });

        const result = await service.verifyPayment(CALLER, INPUT);

        expect(result).toBe(SETTLED.payment);
        expect(eventBus.emit).not.toHaveBeenCalled();
      }));

    it('should throw when the gateway does not confirm the payment', () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, paymentRepo } = setup(vi.fn().mockResolvedValue(null));

        await expect(
          service.verifyPayment(CALLER, { ...INPUT, signature: 'bad_sig' }),
        ).rejects.toMatchObject({ code: ErrorCode.PAYMENT_VERIFICATION_FAILED });
        expect(paymentRepo.settleGatewayOrder).not.toHaveBeenCalled();
      }));

    it("should refuse another institute's order of the same reseller as not found", () =>
      requestContext.run(TEST_CTX, async () => {
        const verify = vi.fn();
        const { service, paymentRepo } = setup(verify);
        paymentRepo.findByGatewayOrderId.mockResolvedValue([{ ...ROW, tenantId: 'tenant-2' }]);

        await expect(
          service.verifyPayment(CALLER, { ...INPUT, gatewayOrderId: 'order_456' }),
        ).rejects.toMatchObject({ code: ErrorCode.PAYMENT_NOT_FOUND });
        expect(verify).not.toHaveBeenCalled();
        expect(paymentRepo.settleGatewayOrder).not.toHaveBeenCalled();
      }));
  });

  describe('handleWebhookPayment', () => {
    const WEBHOOK = {
      gatewayPaymentId: 'pay_gw_123',
      method: PaymentMethod.RAZORPAY,
      amountPaise: 118000n,
      gatewayProvider: 'RAZORPAY',
    };
    const RESULT = {
      payment: { id: 'pay-1', invoiceId: 'inv-1', tenantId: 'tenant-1' },
      credit: null,
    };
    const OWNER = { invoiceId: 'inv-1', tenantId: 'tenant-1' };

    it("should settle the order's payment row instead of adding a second one", () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, paymentRepo, eventBus } = createService();
        paymentRepo.settleGatewayOrder.mockResolvedValue({ ...RESULT, settled: true });

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
        expect(paymentRepo.recordGatewayPayment).not.toHaveBeenCalled();
        expect(eventBus.emit).toHaveBeenCalledWith('BILLING.payment.succeeded', {
          paymentId: 'pay-1',
          invoiceId: 'inv-1',
          tenantId: 'tenant-1',
          resellerId: 'reseller-1',
        });
      }));

    it('should record the system user as actor when the webhook has no user', () =>
      requestContext.run({ ...TEST_CTX, userId: '' }, async () => {
        const { service, paymentRepo } = createService();
        paymentRepo.settleGatewayOrder.mockResolvedValue({ ...RESULT, settled: true });

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

    it('should flag a capture on a cancelled invoice for review and not announce the invoice paid', () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, paymentRepo, eventBus, logger } = createService();
        paymentRepo.settleGatewayOrder.mockResolvedValue({
          ...RESULT,
          credit: {
            invoice: {
              id: 'inv-1',
              tenantId: 'tenant-1',
              subscriptionId: 'sub-1',
              status: 'CANCELLED',
              totalAmount: 118000n,
            },
            becamePaid: false,
            statusBefore: 'CANCELLED',
            overpaidPaise: 0n,
          },
          settled: true,
        });

        await service.handleWebhookPayment('reseller-1', {
          ...WEBHOOK,
          gatewayOrderId: 'order_123',
        });

        expect(logger.warn).toHaveBeenCalledWith(
          'Payment pay-1 needs review: invoice inv-1 was CANCELLED, overpaid by 0 paise',
        );
        expect(eventBus.emit).not.toHaveBeenCalledWith('BILLING.invoice.paid', expect.anything());
      }));

    it('should flag an overpayment for review', () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, paymentRepo, logger } = createService();
        paymentRepo.settleGatewayOrder.mockResolvedValue({
          ...RESULT,
          credit: {
            invoice: {
              id: 'inv-1',
              tenantId: 'tenant-1',
              subscriptionId: 'sub-1',
              status: 'PAID',
              totalAmount: 118000n,
            },
            becamePaid: false,
            statusBefore: 'PAID',
            overpaidPaise: 118000n,
          },
          settled: true,
        });

        await service.handleWebhookPayment('reseller-1', {
          ...WEBHOOK,
          gatewayOrderId: 'order_123',
        });

        expect(logger.warn).toHaveBeenCalledWith(
          'Payment pay-1 needs review: invoice inv-1 was PAID, overpaid by 118000 paise',
        );
      }));

    it('should not announce the payment again after the browser verified it', () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, paymentRepo, eventBus } = createService();
        paymentRepo.settleGatewayOrder.mockResolvedValue({ ...RESULT, settled: false });

        await service.handleWebhookPayment('reseller-1', {
          ...WEBHOOK,
          gatewayOrderId: 'order_123',
        });

        expect(paymentRepo.recordGatewayPayment).not.toHaveBeenCalled();
        expect(eventBus.emit).not.toHaveBeenCalled();
      }));

    it('should record a capture with no order row against the invoice the order named', () =>
      requestContext.run(TEST_CTX, async () => {
        const now = new Date('2026-11-20T10:00:00.000Z');
        vi.useFakeTimers({ now, toFake: ['Date'] });
        const { service, paymentRepo, invoiceRepo, eventBus } = createService();
        paymentRepo.settleGatewayOrder.mockResolvedValue(null);
        invoiceRepo.findById.mockResolvedValue({
          id: 'inv-1',
          tenantId: 'tenant-1',
          currency: 'INR',
        });
        paymentRepo.recordGatewayPayment.mockResolvedValue({ ...RESULT, created: true });

        await service.handleWebhookPayment('reseller-1', {
          ...WEBHOOK,
          gatewayOrderId: 'order_unknown',
          owner: OWNER,
        });

        expect(paymentRepo.recordGatewayPayment).toHaveBeenCalledWith('reseller-1', {
          invoiceId: 'inv-1',
          tenantId: 'tenant-1',
          resellerId: 'reseller-1',
          status: 'SUCCEEDED',
          method: PaymentMethod.RAZORPAY,
          amountPaise: 118000n,
          currency: 'INR',
          gatewayProvider: 'RAZORPAY',
          gatewayPaymentId: 'pay_gw_123',
          gatewayOrderId: 'order_unknown',
          gatewayResponse: null,
          paidAt: now,
          createdBy: 'test-user-1',
          updatedBy: 'test-user-1',
        });
        expect(eventBus.emit).toHaveBeenCalledWith('BILLING.payment.succeeded', {
          paymentId: 'pay-1',
          invoiceId: 'inv-1',
          tenantId: 'tenant-1',
          resellerId: 'reseller-1',
        });
        vi.useRealTimers();
      }));

    it('should not record a capture that names no invoice of this reseller', () =>
      requestContext.run(TEST_CTX, async () => {
        const { service, paymentRepo, invoiceRepo } = createService();
        paymentRepo.settleGatewayOrder.mockResolvedValue(null);
        invoiceRepo.findById.mockResolvedValue({
          id: 'inv-1',
          tenantId: 'tenant-9',
          currency: 'INR',
        });

        const withoutOwner = await service.handleWebhookPayment('reseller-1', {
          ...WEBHOOK,
          gatewayOrderId: 'order_unknown',
        });
        const wrongTenant = await service.handleWebhookPayment('reseller-1', {
          ...WEBHOOK,
          gatewayOrderId: 'order_unknown',
          owner: OWNER,
        });

        expect(withoutOwner).toBeNull();
        expect(wrongTenant).toBeNull();
        expect(paymentRepo.recordGatewayPayment).not.toHaveBeenCalled();
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
