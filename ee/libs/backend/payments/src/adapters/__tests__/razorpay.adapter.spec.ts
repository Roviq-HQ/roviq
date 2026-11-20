import { ConfigService } from '@nestjs/config';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RazorpayAdapter } from '../razorpay.adapter';

const mockPlans = { create: vi.fn(), fetch: vi.fn() };
const mockSubscriptions = {
  create: vi.fn(),
  fetch: vi.fn(),
  cancel: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
};
const mockInvoices = { all: vi.fn() };
const mockPayments = { refund: vi.fn() };
const mockOrders = { create: vi.fn(), fetch: vi.fn(), fetchPayments: vi.fn() };

vi.mock('razorpay', () => ({
  default: vi.fn(
    class MockRazorpay {
      plans = mockPlans;
      subscriptions = mockSubscriptions;
      invoices = mockInvoices;
      payments = mockPayments;
      orders = mockOrders;
    },
  ),
}));

const { mockValidateWebhookSignature } = vi.hoisted(() => ({
  mockValidateWebhookSignature: vi.fn(),
}));

vi.mock('razorpay/dist/utils/razorpay-utils', () => ({
  validateWebhookSignature: mockValidateWebhookSignature,
}));

function createMockConfig(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = {
    RAZORPAY_KEY_ID: 'rzp_test_123',
    RAZORPAY_KEY_SECRET: 'secret_123',
    RAZORPAY_WEBHOOK_SECRET: 'whsec_123',
    ...overrides,
  };
  return createMock<ConfigService>({
    getOrThrow: vi.fn((key: string) => {
      const val = values[key];
      if (!val) throw new Error(`Missing ${key}`);
      return val;
    }),
  });
}

describe('RazorpayAdapter', () => {
  let adapter: RazorpayAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new RazorpayAdapter(createMockConfig());
  });

  describe('createPlan', () => {
    it('should call razorpay plans.create and map the response', async () => {
      mockPlans.create.mockResolvedValue({
        id: 'plan_abc',
        item: { name: 'Pro Plan', amount: 99900, currency: 'INR' },
        period: 'monthly',
        interval: 1,
      });

      const result = await adapter.createPlan({
        name: 'Pro Plan',
        amount: 99900n,
        currency: 'INR',
        interval: 'MONTHLY',
      });

      expect(result.providerPlanId).toBe('plan_abc');
      expect(result.name).toBe('Pro Plan');
    });
  });

  describe('invoice orders', () => {
    const ORDER_INPUT = {
      invoiceId: 'inv-1',
      amountPaise: 118000n,
      currency: 'INR',
      customer: { name: 'Saraswati Vidya Mandir', email: 'a@svm.example', phone: '9000000002' },
      returnUrl: 'https://app.roviq.com/billing/invoices/inv-1?order_id={order_id}',
      owner: { invoiceId: 'inv-1', tenantId: 'tenant-1' },
    };
    const ORDER = {
      id: 'order_123',
      amount: 118000,
      amount_due: 118000,
      currency: 'INR',
      status: 'created',
    };
    const CHECKOUT = {
      gatewayOrderId: 'order_123',
      gatewayProvider: 'RAZORPAY',
      checkoutPayload: {
        key: 'rzp_test_123',
        order_id: 'order_123',
        amount: 118000,
        currency: 'INR',
      },
    };

    it('should return Checkout options without a callback_url, so the handler gets the signature', async () => {
      mockOrders.create.mockResolvedValue(ORDER);

      const result = await adapter.createOrder(ORDER_INPUT);

      expect(mockOrders.create).toHaveBeenCalledWith({
        amount: 118000,
        currency: 'INR',
        receipt: 'inv-1',
        notes: { invoiceId: 'inv-1', tenantId: 'tenant-1' },
      });
      expect(result).toEqual(CHECKOUT);
    });

    it('should reopen an unpaid order for the same amount', async () => {
      mockOrders.fetch.mockResolvedValue(ORDER);

      expect(await adapter.resumeOrder('order_123', ORDER_INPUT)).toEqual({
        state: 'OPEN',
        checkout: CHECKOUT,
      });
    });

    it('should report a paid order as PAID', async () => {
      mockOrders.fetch.mockResolvedValue({ ...ORDER, status: 'paid', amount_due: 0 });

      expect(await adapter.resumeOrder('order_123', ORDER_INPUT)).toEqual({ state: 'PAID' });
    });

    it('should close an order whose amount no longer matches the balance', async () => {
      mockOrders.fetch.mockResolvedValue({ ...ORDER, amount_due: 50000 });

      expect(await adapter.resumeOrder('order_123', ORDER_INPUT)).toEqual({ state: 'CLOSED' });
    });

    it('should close an order these keys do not know, such as one made with test keys', async () => {
      mockOrders.fetch.mockRejectedValue({
        statusCode: 400,
        error: { code: 'BAD_REQUEST_ERROR', description: 'The id provided does not exist' },
      });

      expect(await adapter.resumeOrder('order_test', ORDER_INPUT)).toEqual({ state: 'CLOSED' });
    });

    it('should report other fetch failures as gateway errors', async () => {
      mockOrders.fetch.mockRejectedValue({
        statusCode: 500,
        error: { code: 'SERVER_ERROR', description: 'down' },
      });

      await expect(adapter.resumeOrder('order_123', ORDER_INPUT)).rejects.toMatchObject({
        name: 'PaymentGatewayError',
        provider: 'RAZORPAY',
      });
    });

    it("should find an order's captured payment", async () => {
      mockOrders.fetchPayments.mockResolvedValue({
        entity: 'collection',
        count: 2,
        items: [
          { id: 'pay_failed', status: 'failed' },
          { id: 'pay_ok', status: 'captured' },
        ],
      });

      expect(await adapter.findPaidPayment('order_123')).toEqual({ gatewayPaymentId: 'pay_ok' });
      expect(mockOrders.fetchPayments).toHaveBeenCalledWith('order_123');
    });

    it('should answer null when the order has no captured payment yet', async () => {
      mockOrders.fetchPayments.mockResolvedValue({
        entity: 'collection',
        count: 1,
        items: [{ id: 'pay_auth', status: 'authorized' }],
      });

      expect(await adapter.findPaidPayment('order_123')).toBeNull();
    });

    it('should verify the checkout signature over order_id|payment_id', async () => {
      mockValidateWebhookSignature.mockReturnValue(true);

      const result = await adapter.verifyPayment({
        gatewayOrderId: 'order_123',
        gatewayPaymentId: 'pay_123',
        signature: 'sig',
      });

      expect(mockValidateWebhookSignature).toHaveBeenCalledWith(
        'order_123|pay_123',
        'sig',
        'secret_123',
      );
      expect(result).toEqual({ gatewayPaymentId: 'pay_123' });
    });

    it('should not confirm a payment without the checkout signature', async () => {
      expect(await adapter.verifyPayment({ gatewayOrderId: 'order_123' })).toBeNull();
      expect(mockValidateWebhookSignature).not.toHaveBeenCalled();
    });

    it('should not confirm a payment with a bad signature', async () => {
      mockValidateWebhookSignature.mockReturnValue(false);

      expect(
        await adapter.verifyPayment({
          gatewayOrderId: 'order_123',
          gatewayPaymentId: 'pay_123',
          signature: 'bad',
        }),
      ).toBeNull();
    });
  });

  describe('parseWebhook', () => {
    function eventBody(event: string, status: string) {
      return {
        entity: 'event',
        event,
        payload: {
          payment: {
            entity: {
              id: 'pay_1',
              amount: 118000,
              status,
              order_id: 'order_1',
              notes: { invoiceId: 'inv-1', tenantId: 'tenant-1' },
            },
          },
        },
      };
    }
    const body = (event: string, status: string) =>
      Buffer.from(JSON.stringify(eventBody(event, status)));

    it('should read a capture with the invoice and institute from the order notes', () => {
      mockValidateWebhookSignature.mockReturnValue(true);

      const event = adapter.parseWebhook(body('payment.captured', 'captured'), {
        'x-razorpay-signature': 'sig',
      });

      expect(event).toEqual({
        eventType: 'payment.captured',
        gatewayEventId: 'rzp_payment.captured_pay_1',
        gatewayOrderId: 'order_1',
        gatewayPaymentId: 'pay_1',
        amountPaise: 118000,
        status: 'captured',
        isCapture: true,
        owner: { invoiceId: 'inv-1', tenantId: 'tenant-1' },
        payload: eventBody('payment.captured', 'captured'),
      });
    });

    it('should not treat a refund event as a capture, although its payment is captured', () => {
      mockValidateWebhookSignature.mockReturnValue(true);

      const event = adapter.parseWebhook(body('refund.processed', 'captured'), {
        'x-razorpay-signature': 'sig',
      });

      expect(event.isCapture).toBe(false);
    });

    it('should not treat a failed payment as a capture', () => {
      mockValidateWebhookSignature.mockReturnValue(true);

      const event = adapter.parseWebhook(body('payment.failed', 'failed'), {
        'x-razorpay-signature': 'sig',
      });

      expect(event.isCapture).toBe(false);
    });
  });

  describe('verifyWebhook', () => {
    it('should call validateWebhookSignature with correct params', () => {
      mockValidateWebhookSignature.mockReturnValue(true);

      const headers = { 'x-razorpay-signature': 'sig123' };
      const rawBody = '{"event":"payment.captured","payload":{}}';

      const result = adapter.verifyWebhook(headers, rawBody);

      expect(mockValidateWebhookSignature).toHaveBeenCalledWith(rawBody, 'sig123', 'whsec_123');
      expect(result.eventType).toBe('payment.captured');
    });
  });
});
