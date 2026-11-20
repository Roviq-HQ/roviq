import { PaymentMethod } from '@roviq/ee-billing-types';
import type { PaymentGatewayFactory, WebhookEvent } from '@roviq/ee-payments';
import { createMock } from '@roviq/testing';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { PaymentService } from '../../reseller/payment.service';
import { CashfreeWebhookController } from '../cashfree-webhook.controller';
import { RazorpayWebhookController } from '../razorpay-webhook.controller';

function setup(event: WebhookEvent) {
  const gatewayFactory = createMock<PaymentGatewayFactory>({
    create: vi.fn().mockResolvedValue({ parseWebhook: vi.fn().mockReturnValue(event) }),
  });
  const paymentService = createMock<PaymentService>({ handleWebhookPayment: vi.fn() });
  const json = vi.fn();
  const res = createMock<Response>({ json, status: vi.fn().mockReturnValue({ json }) });
  const req = Object.assign(createMock<Request>(), {
    rawBody: Buffer.from('{}'),
    headers: {},
  });
  return { gatewayFactory, paymentService, req, res, json };
}

const BASE: WebhookEvent = {
  eventType: 'payment.captured',
  gatewayEventId: 'evt_1',
  gatewayOrderId: 'order_123',
  gatewayPaymentId: 'pay_123',
  amountPaise: 118000,
  payload: {},
};

describe('RazorpayWebhookController', () => {
  it('should record a captured payment', async () => {
    const ctx = setup({ ...BASE, status: 'captured' });
    const controller = new RazorpayWebhookController(ctx.gatewayFactory, ctx.paymentService);

    await controller.handle('reseller-1', ctx.req, ctx.res);

    expect(ctx.paymentService.handleWebhookPayment).toHaveBeenCalledWith('reseller-1', {
      gatewayPaymentId: 'pay_123',
      gatewayOrderId: 'order_123',
      invoiceId: '',
      tenantId: '',
      method: PaymentMethod.RAZORPAY,
      amountPaise: 118000n,
      gatewayProvider: 'RAZORPAY',
      gatewayResponse: {},
    });
  });

  it('should not pay the invoice for a failed payment', async () => {
    const ctx = setup({ ...BASE, eventType: 'payment.failed', status: 'failed' });
    const controller = new RazorpayWebhookController(ctx.gatewayFactory, ctx.paymentService);

    await controller.handle('reseller-1', ctx.req, ctx.res);

    expect(ctx.paymentService.handleWebhookPayment).not.toHaveBeenCalled();
    expect(ctx.json).toHaveBeenCalledWith({ status: 'ok' });
  });
});

describe('CashfreeWebhookController', () => {
  it('should record a successful payment', async () => {
    const ctx = setup({ ...BASE, eventType: 'PAYMENT_SUCCESS_WEBHOOK', status: 'SUCCESS' });
    const controller = new CashfreeWebhookController(ctx.gatewayFactory, ctx.paymentService);

    await controller.handle('reseller-1', ctx.req, ctx.res);

    expect(ctx.paymentService.handleWebhookPayment).toHaveBeenCalledWith('reseller-1', {
      gatewayPaymentId: 'pay_123',
      gatewayOrderId: 'order_123',
      invoiceId: '',
      tenantId: '',
      method: PaymentMethod.CASHFREE,
      amountPaise: 118000n,
      gatewayProvider: 'CASHFREE',
      gatewayResponse: {},
    });
  });

  it('should not pay the invoice for a failed payment', async () => {
    const ctx = setup({ ...BASE, eventType: 'PAYMENT_FAILED_WEBHOOK', status: 'FAILED' });
    const controller = new CashfreeWebhookController(ctx.gatewayFactory, ctx.paymentService);

    await controller.handle('reseller-1', ctx.req, ctx.res);

    expect(ctx.paymentService.handleWebhookPayment).not.toHaveBeenCalled();
    expect(ctx.json).toHaveBeenCalledWith({ status: 'ok' });
  });
});
