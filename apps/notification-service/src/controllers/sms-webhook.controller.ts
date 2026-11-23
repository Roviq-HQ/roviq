import { timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { SmsHttp } from '../delivery/sms/sms-http';
import { parseSmsReports } from '../delivery/sms/sms-report';
import { SmsWebhookService } from '../services/sms-webhook.service';

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The address the SMS provider posts delivery reports to. The provider cannot sign its calls,
 * so the address itself carries a secret (`SMS_WEBHOOK_SECRET`): a call without it is refused
 * before the body is read. The request log replaces that path segment (`scrubRequestUrl`).
 * A report can only add a DELIVERED or FAILED row to a message this service sent.
 */
@Controller('webhooks/sms')
export class SmsWebhookController {
  constructor(
    private readonly sms: SmsHttp,
    private readonly webhook: SmsWebhookService,
  ) {}

  @Post(':secret')
  @HttpCode(200)
  async receive(@Param('secret') secret: string, @Body() body: unknown): Promise<string> {
    if (!this.sms.enabled) throw new NotFoundException();
    if (!sameSecret(secret, this.sms.webhookSecret)) throw new UnauthorizedException();
    // A database error propagates as 500, so the provider posts the report again.
    await this.webhook.handle(parseSmsReports(body));
    return 'ok';
  }
}
