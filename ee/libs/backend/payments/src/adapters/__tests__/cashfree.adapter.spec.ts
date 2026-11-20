import { ConfigService } from '@nestjs/config';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CashfreeAdapter } from '../cashfree.adapter';

const mockSubsCreatePlan = vi.fn();
const mockSubsFetchPlan = vi.fn();
const mockSubsCreateSubscription = vi.fn();
const mockSubsFetchSubscription = vi.fn();
const mockSubsManageSubscription = vi.fn();
const mockSubsFetchSubscriptionPayments = vi.fn();
const mockSubsCreateRefund = vi.fn();
const mockPGVerifyWebhookSignature = vi.fn();
const mockPGCreateOrder = vi.fn();
const mockPGFetchOrder = vi.fn();
const mockPGOrderFetchPayments = vi.fn();

vi.mock('cashfree-pg', () => ({
  Cashfree: vi.fn(
    class MockCashfree {
      XApiVersion = '2025-01-01';
      SubsCreatePlan = mockSubsCreatePlan;
      SubsFetchPlan = mockSubsFetchPlan;
      SubsCreateSubscription = mockSubsCreateSubscription;
      SubsFetchSubscription = mockSubsFetchSubscription;
      SubsManageSubscription = mockSubsManageSubscription;
      SubsFetchSubscriptionPayments = mockSubsFetchSubscriptionPayments;
      SubsCreateRefund = mockSubsCreateRefund;
      PGVerifyWebhookSignature = mockPGVerifyWebhookSignature;
      PGCreateOrder = mockPGCreateOrder;
      PGFetchOrder = mockPGFetchOrder;
      PGOrderFetchPayments = mockPGOrderFetchPayments;
    },
  ),
  CFEnvironment: { SANDBOX: 1, PRODUCTION: 2 },
}));

function createMockConfig(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = {
    CASHFREE_CLIENT_ID: 'cf_test_123',
    CASHFREE_CLIENT_SECRET: 'cf_secret_123',
    CASHFREE_ENVIRONMENT: 'SANDBOX',
    CASHFREE_API_VERSION: '2025-01-01',
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

describe('CashfreeAdapter', () => {
  let adapter: CashfreeAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new CashfreeAdapter(createMockConfig());
  });

  describe('createPlan', () => {
    it('should call SubsCreatePlan and map response', async () => {
      mockSubsCreatePlan.mockResolvedValue({
        data: { plan_id: 'plan_cf_123', plan_name: 'Pro Plan' },
      });

      const result = await adapter.createPlan({
        name: 'Pro Plan',
        amount: 99900n,
        currency: 'INR',
        interval: 'MONTHLY',
      });

      expect(result.providerPlanId).toBe('plan_cf_123');
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
    const ACTIVE = {
      order_status: 'ACTIVE',
      order_amount: 1180,
      payment_session_id: 'session_1',
    };

    it('should create an order under our own order id and return the payment session', async () => {
      mockPGCreateOrder.mockResolvedValue({ data: { payment_session_id: 'session_1' } });

      const result = await adapter.createOrder(ORDER_INPUT);

      const [request] = mockPGCreateOrder.mock.calls[0];
      expect(request).toEqual({
        order_id: result.gatewayOrderId,
        order_amount: 1180,
        order_currency: 'INR',
        customer_details: {
          customer_id: 'inv-1',
          customer_name: 'Saraswati Vidya Mandir',
          customer_email: 'a@svm.example',
          customer_phone: '9000000002',
        },
        order_meta: { return_url: ORDER_INPUT.returnUrl },
        order_note: undefined,
        order_tags: { invoiceId: 'inv-1', tenantId: 'tenant-1' },
      });
      expect(result.gatewayOrderId).toMatch(/^ord_[0-9a-f-]{36}$/);
      expect(result).toEqual({
        gatewayOrderId: result.gatewayOrderId,
        gatewayProvider: 'CASHFREE',
        checkoutPayload: { paymentSessionId: 'session_1', mode: 'sandbox' },
      });
    });

    it('should fail when Cashfree returns no payment session', async () => {
      mockPGCreateOrder.mockResolvedValue({ data: {} });

      await expect(adapter.createOrder(ORDER_INPUT)).rejects.toThrow(/payment_session_id/);
    });

    it('should reopen an active order for the same amount', async () => {
      mockPGFetchOrder.mockResolvedValue({ data: ACTIVE });

      expect(await adapter.resumeOrder('ord_1', ORDER_INPUT)).toEqual({
        state: 'OPEN',
        checkout: {
          gatewayOrderId: 'ord_1',
          gatewayProvider: 'CASHFREE',
          checkoutPayload: { paymentSessionId: 'session_1', mode: 'sandbox' },
        },
      });
    });

    it('should report a paid order as PAID', async () => {
      mockPGFetchOrder.mockResolvedValue({ data: { ...ACTIVE, order_status: 'PAID' } });

      expect(await adapter.resumeOrder('ord_1', ORDER_INPUT)).toEqual({ state: 'PAID' });
    });

    it('should close an expired order or one for another amount', async () => {
      mockPGFetchOrder.mockResolvedValueOnce({ data: { ...ACTIVE, order_status: 'EXPIRED' } });
      mockPGFetchOrder.mockResolvedValueOnce({ data: { ...ACTIVE, order_amount: 500 } });

      expect(await adapter.resumeOrder('ord_1', ORDER_INPUT)).toEqual({ state: 'CLOSED' });
      expect(await adapter.resumeOrder('ord_1', ORDER_INPUT)).toEqual({ state: 'CLOSED' });
    });

    it('should confirm a paid order with its successful payment id', async () => {
      mockPGFetchOrder.mockResolvedValue({ data: { ...ACTIVE, order_status: 'PAID' } });
      mockPGOrderFetchPayments.mockResolvedValue({
        data: [
          { payment_status: 'FAILED', cf_payment_id: 11 },
          { payment_status: 'SUCCESS', cf_payment_id: 12 },
        ],
      });

      expect(await adapter.verifyPayment({ gatewayOrderId: 'ord_1' })).toEqual({
        gatewayPaymentId: '12',
      });
    });

    it('should close an order these credentials do not know', async () => {
      mockPGFetchOrder.mockRejectedValue(
        Object.assign(new Error('Request failed with status code 404'), {
          isAxiosError: true,
          response: { status: 404, data: { message: 'order not found' } },
        }),
      );

      expect(await adapter.resumeOrder('ord_sandbox', ORDER_INPUT)).toEqual({ state: 'CLOSED' });
    });

    it('should report a failed lookup as a gateway error, not as an unpaid order', async () => {
      mockPGFetchOrder.mockRejectedValue(new Error('socket hang up'));

      await expect(adapter.verifyPayment({ gatewayOrderId: 'ord_1' })).rejects.toMatchObject({
        name: 'PaymentGatewayError',
        provider: 'CASHFREE',
      });
    });

    it('should not confirm an order that is not paid', async () => {
      mockPGFetchOrder.mockResolvedValue({ data: ACTIVE });

      expect(await adapter.verifyPayment({ gatewayOrderId: 'ord_1' })).toBeNull();
      expect(mockPGOrderFetchPayments).not.toHaveBeenCalled();
    });
  });

  describe('parseWebhook', () => {
    function successBody(type: string, paymentStatus: string) {
      return {
        type,
        event_time: '2026-11-20T11:16:10+05:30',
        data: {
          order: {
            order_id: 'ord_1',
            order_amount: 1180,
            order_tags: { invoiceId: 'inv-1', tenantId: 'tenant-1' },
          },
          payment: {
            cf_payment_id: 1453002795,
            payment_status: paymentStatus,
            payment_amount: 1180,
          },
        },
      };
    }
    const headers = { 'x-webhook-signature': 'sig', 'x-webhook-timestamp': '1' };

    it('should read the order and payment from where Cashfree puts them', () => {
      const raw = successBody('PAYMENT_SUCCESS_WEBHOOK', 'SUCCESS');

      const event = adapter.parseWebhook(Buffer.from(JSON.stringify(raw)), headers);

      expect(event).toEqual({
        eventType: 'PAYMENT_SUCCESS_WEBHOOK',
        gatewayEventId: event.gatewayEventId,
        gatewayOrderId: 'ord_1',
        gatewayPaymentId: '1453002795',
        amountPaise: 118000,
        status: 'SUCCESS',
        isCapture: true,
        owner: { invoiceId: 'inv-1', tenantId: 'tenant-1' },
        payload: raw,
      });
      expect(event.gatewayEventId).toMatch(/^cf_PAYMENT_SUCCESS_WEBHOOK_/);
    });

    it('should not treat a failed payment as a capture', () => {
      const raw = successBody('PAYMENT_FAILED_WEBHOOK', 'FAILED');

      expect(adapter.parseWebhook(Buffer.from(JSON.stringify(raw)), headers).isCapture).toBe(false);
    });
  });

  describe('verifyWebhook', () => {
    const headers = {
      'x-webhook-signature': 'sig123',
      'x-webhook-timestamp': '1234567890',
    };

    function verifyWithBody(body: Record<string, unknown>) {
      const rawBody = JSON.stringify(body);
      return adapter.verifyWebhook(headers, rawBody);
    }

    it('should verify signature and extract IDs from payment events', () => {
      const result = verifyWithBody({
        type: 'SUBSCRIPTION_PAYMENT_SUCCESS',
        data: {
          subscription_id: 'sub_123',
          cf_payment_id: 'pay_456',
        },
      });

      expect(mockPGVerifyWebhookSignature).toHaveBeenCalledWith(
        'sig123',
        expect.any(String),
        '1234567890',
      );
      expect(result.providerSubscriptionId).toBe('sub_123');
      expect(result.providerPaymentId).toBe('pay_456');
    });

    it('should extract subscription ID from status changed events', () => {
      const result = verifyWithBody({
        type: 'SUBSCRIPTION_STATUS_CHANGED',
        data: {
          subscription_details: {
            subscription_id: 'sub_789',
            subscription_status: 'ACTIVE',
          },
        },
      });

      expect(result.providerSubscriptionId).toBe('sub_789');
      expect(result.providerPaymentId).toBeUndefined();
    });

    it('should extract subscription ID from card expiry events', () => {
      const result = verifyWithBody({
        type: 'SUBSCRIPTION_CARD_EXPIRY_REMINDER',
        data: {
          subscription_status_webhook: {
            subscription_details: {
              subscription_id: 'sub_expiry',
              subscription_status: 'ACTIVE',
            },
          },
          card_expiry_date: '2026-06-01',
        },
      });

      expect(result.providerSubscriptionId).toBe('sub_expiry');
    });

    it('should normalize SUBSCRIPTION_PAYMENT_SUCCESS → subscription.charged', () => {
      const result = verifyWithBody({ type: 'SUBSCRIPTION_PAYMENT_SUCCESS' });
      expect(result.eventType).toBe('subscription.charged');
    });

    it('should normalize SUBSCRIPTION_PAYMENT_FAILED → payment.failed', () => {
      const result = verifyWithBody({ type: 'SUBSCRIPTION_PAYMENT_FAILED' });
      expect(result.eventType).toBe('payment.failed');
    });

    it('should normalize SUBSCRIPTION_PAYMENT_CANCELLED → payment.cancelled', () => {
      const result = verifyWithBody({ type: 'SUBSCRIPTION_PAYMENT_CANCELLED' });
      expect(result.eventType).toBe('payment.cancelled');
    });

    it('should normalize SUBSCRIPTION_CARD_EXPIRY_REMINDER → subscription.card_expiry_reminder', () => {
      const result = verifyWithBody({ type: 'SUBSCRIPTION_CARD_EXPIRY_REMINDER' });
      expect(result.eventType).toBe('subscription.card_expiry_reminder');
    });

    describe('SUBSCRIPTION_STATUS_CHANGED normalization', () => {
      function verifyStatusChanged(status: string) {
        return verifyWithBody({
          type: 'SUBSCRIPTION_STATUS_CHANGED',
          data: { subscription_details: { subscription_status: status } },
        });
      }

      it('ACTIVE → subscription.activated', () => {
        expect(verifyStatusChanged('ACTIVE').eventType).toBe('subscription.activated');
      });

      it('CUSTOMER_CANCELLED → subscription.cancelled', () => {
        expect(verifyStatusChanged('CUSTOMER_CANCELLED').eventType).toBe('subscription.cancelled');
      });

      it('CANCELLED → subscription.cancelled', () => {
        expect(verifyStatusChanged('CANCELLED').eventType).toBe('subscription.cancelled');
      });

      it('CUSTOMER_PAUSED → subscription.paused', () => {
        expect(verifyStatusChanged('CUSTOMER_PAUSED').eventType).toBe('subscription.paused');
      });

      it('ON_HOLD → subscription.halted', () => {
        expect(verifyStatusChanged('ON_HOLD').eventType).toBe('subscription.halted');
      });

      it('CARD_EXPIRED → subscription.halted', () => {
        expect(verifyStatusChanged('CARD_EXPIRED').eventType).toBe('subscription.halted');
      });

      it('COMPLETED → subscription.completed', () => {
        expect(verifyStatusChanged('COMPLETED').eventType).toBe('subscription.completed');
      });

      it('EXPIRED → subscription.completed', () => {
        expect(verifyStatusChanged('EXPIRED').eventType).toBe('subscription.completed');
      });

      it('LINK_EXPIRED → subscription.completed', () => {
        expect(verifyStatusChanged('LINK_EXPIRED').eventType).toBe('subscription.completed');
      });

      it('BANK_APPROVAL_PENDING → subscription.pending', () => {
        expect(verifyStatusChanged('BANK_APPROVAL_PENDING').eventType).toBe('subscription.pending');
      });

      it('unknown status → subscription.status_changed.<status>', () => {
        expect(verifyStatusChanged('SOME_NEW').eventType).toBe(
          'subscription.status_changed.some_new',
        );
      });
    });

    it('should pass through unknown event types unchanged', () => {
      const result = verifyWithBody({ type: 'SOME_UNKNOWN_EVENT' });
      expect(result.eventType).toBe('SOME_UNKNOWN_EVENT');
    });
  });
});
