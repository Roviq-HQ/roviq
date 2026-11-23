import { Injectable } from '@nestjs/common';
import { SMS_HTTP_PROVIDER } from '../delivery/sms/sms-http.client';
import type { SmsReport } from '../delivery/sms/sms-report';
import { DeliveryReceiptRepository } from '../repositories/delivery-receipt.repository';

/** Turns the SMS provider's delivery reports into delivery rows. Safe to repeat. */
@Injectable()
export class SmsWebhookService {
  constructor(private readonly receipts: DeliveryReceiptRepository) {}

  async handle(reports: readonly SmsReport[]): Promise<void> {
    for (const report of reports) {
      await this.receipts.record({
        provider: SMS_HTTP_PROVIDER,
        providerMessageId: report.requestId,
        status: report.status,
        errorCode: report.errorCode,
      });
    }
  }
}
