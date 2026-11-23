import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Post,
  Query,
  type RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { parseWebhookPayload } from '../delivery/whatsapp/webhook-payload';
import { isSignedByProvider } from '../delivery/whatsapp/webhook-signature';
import { WhatsAppCloud } from '../delivery/whatsapp/whatsapp-cloud';
import { WhatsAppWebhookService } from '../services/whatsapp-webhook.service';

/**
 * The one address the WhatsApp provider calls: delivery reports and inbound messages.
 * Nothing is read from a call until its signature over the raw body is verified.
 */
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(
    private readonly cloud: WhatsAppCloud,
    private readonly webhook: WhatsAppWebhookService,
  ) {}

  /** The provider's one-time check when the address is registered: echo its challenge. */
  @Get()
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    if (!this.cloud.enabled) throw new NotFoundException();
    if (mode !== 'subscribe' || token !== this.cloud.verifyToken || !challenge) {
      throw new ForbiddenException();
    }
    return challenge;
  }

  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature?: string,
  ): Promise<string> {
    if (!this.cloud.enabled) throw new NotFoundException();
    if (!req.rawBody || !isSignedByProvider(req.rawBody, signature, this.cloud.appSecret)) {
      throw new UnauthorizedException();
    }
    let body: unknown;
    try {
      body = JSON.parse(req.rawBody.toString('utf8'));
    } catch {
      return 'ignored';
    }
    // A database error propagates as 500, so the provider sends the events again.
    await this.webhook.handle(parseWebhookPayload(body));
    return 'ok';
  }
}
