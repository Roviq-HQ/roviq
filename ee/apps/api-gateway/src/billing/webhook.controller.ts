import { Controller, HttpCode, Logger, Post, Req, Res } from '@nestjs/common';
import { PaymentGatewayFactory, type ProviderWebhookEvent } from '@roviq/ee-payments';
import type { Request, Response } from 'express';
import { BillingService } from './billing.service';

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly billingService: BillingService,
    private readonly gatewayFactory: PaymentGatewayFactory,
  ) {}

  @Post('razorpay')
  @HttpCode(200)
  async handleRazorpay(@Req() req: RawBodyRequest, @Res() res: Response) {
    return this.handleWebhook('RAZORPAY', req, res, {
      'x-razorpay-signature': String(req.headers['x-razorpay-signature'] ?? ''),
    });
  }

  @Post('cashfree')
  @HttpCode(200)
  async handleCashfree(@Req() req: RawBodyRequest, @Res() res: Response) {
    return this.handleWebhook('CASHFREE', req, res, {
      'x-webhook-signature': String(req.headers['x-webhook-signature'] ?? ''),
      'x-webhook-timestamp': String(req.headers['x-webhook-timestamp'] ?? ''),
    });
  }

  private async handleWebhook(
    provider: 'RAZORPAY' | 'CASHFREE',
    req: RawBodyRequest,
    res: Response,
    headers: Record<string, string>,
  ) {
    if (!req.rawBody) {
      this.logger.error(
        `${provider} webhook: rawBody not available — ensure rawBody parsing is enabled`,
      );
      return res.status(400).json({ error: 'Raw body not available' });
    }

    const gateway = this.gatewayFactory.getForProvider(provider);
    const rawBody = req.rawBody.toString();

    let event: ProviderWebhookEvent;
    try {
      event = gateway.verifyWebhook(headers, rawBody);
    } catch (error) {
      this.logger.error(
        `${provider} webhook signature verification failed`,
        (error as Error).message,
      );
      return res.status(400).json({ error: 'Webhook verification failed' });
    }

    try {
      await this.billingService.processWebhookEvent(provider, event);
      return res.json({ status: 'ok' });
    } catch (error) {
      this.logger.error(`${provider} webhook processing failed`, (error as Error).message);
      return res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
}
