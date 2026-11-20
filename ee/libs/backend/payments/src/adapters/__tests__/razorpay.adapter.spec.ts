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
const mockOrders = { create: vi.fn(), fetch: vi.fn() };

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
        notes: {},
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
