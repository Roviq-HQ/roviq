import { Injectable } from '@nestjs/common';
import { SMS_HTTP_PROVIDER } from '../delivery/sms/sms-http.client';
import type { SmsReport } from '../delivery/sms/sms-report';
import { DeliveryReceiptRepository } from '../repositories/delivery-receipt.repository';
import { NotificationMetrics } from '../telemetry/notification-metrics';
import { FlowArrivals } from './flow-arrivals.service';

/**
 * Turns the SMS provider's delivery reports into delivery rows, and tells the flow a message
 * arrived. Safe to repeat.
 */
@Injectable()
export class SmsWebhookService {
  constructor(
    private readonly receipts: DeliveryReceiptRepository,
    private readonly arrivals: FlowArrivals,
    private readonly metrics: NotificationMetrics,
  ) {}

  async handle(reports: readonly SmsReport[]): Promise<void> {
    for (const report of reports) {
      const result = await this.receipts.record({
        provider: SMS_HTTP_PROVIDER,
        providerMessageId: report.requestId,
        status: report.status,
        errorCode: report.errorCode,
      });
      if (result.kind === 'recorded') this.metrics.reported(result.written);
      if (result.kind === 'recorded') this.metrics.reported(result.written);
      if (result.kind === 'recorded' && result.arrival) {
        const { flowId, recipientUserId, channel } = result.arrival;
        await this.arrivals.arrived(flowId, recipientUserId, channel);
      }
    }
  }
}
