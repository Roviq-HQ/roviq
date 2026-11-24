import { Injectable, Logger } from '@nestjs/common';
import { ChannelAdapterError } from '../delivery/adapters/channel-adapter';
import type {
  InboundBatch,
  InboundMessage,
  InboundReceipt,
} from '../delivery/whatsapp/webhook-payload';
import { WhatsAppCloud } from '../delivery/whatsapp/whatsapp-cloud';
import {
  errorCodeForProviderCode,
  WHATSAPP_CLOUD_PROVIDER,
} from '../delivery/whatsapp/whatsapp-cloud.client';
import { Clock } from '../delivery/whatsapp/whatsapp-route';
import { MessagingInboundRepository } from '../repositories/messaging-inbound.repository';
import { MessagingSenderRepository } from '../repositories/messaging-sender.repository';
import type { MessagingSenderRecord } from '../repositories/types';
import { NotificationMetrics } from '../telemetry/notification-metrics';
import { FlowArrivals } from './flow-arrivals.service';

/** Sent once when a person asks to stop. Both languages: the person's own is not known here. */
export const STOP_CONFIRMATION =
  'You will not get WhatsApp alerts from this number any more. This includes security alerts about your account; those still reach you by email and in the app. Send START to get WhatsApp alerts again.\n\n' +
  'अब आपको इस नंबर से व्हाट्सऐप सूचनाएँ नहीं मिलेंगी। इसमें आपके खाते की सुरक्षा सूचनाएँ भी शामिल हैं; वे ईमेल और ऐप में मिलती रहेंगी। व्हाट्सऐप सूचनाएँ फिर से पाने के लिए START भेजें।';

/** Sent once when a person who stopped asks to get alerts again. */
export const START_CONFIRMATION =
  'You will get WhatsApp alerts from this number again. Send STOP to stop them.\n\n' +
  'अब आपको इस नंबर से व्हाट्सऐप सूचनाएँ फिर से मिलेंगी। इन्हें बंद करने के लिए STOP भेजें।';

/** The one reply a day to anything else a person writes. */
export const AUTO_REPLY =
  'This number only sends alerts, and messages sent here are not read. Please contact your institute directly. Send STOP to stop these alerts.\n\n' +
  'यह नंबर केवल सूचनाएँ भेजता है और यहाँ भेजे गए संदेश पढ़े नहीं जाते। कृपया सीधे अपने संस्थान से संपर्क करें। ये सूचनाएँ बंद करने के लिए STOP भेजें।';

/** The day "one reply a day" is counted in. */
const REPLY_DAY_TIMEZONE = 'Asia/Kolkata';

/**
 * Acts on what the provider reports: delivery reports become delivery rows (a delivered one tells
 * its flow), STOP and START
 * change whether the person is sent to, anything else gets one fixed reply a day. Every step is safe to repeat,
 * and the institute is known only through the sender the event arrived on.
 */
@Injectable()
export class WhatsAppWebhookService {
  private readonly logger = new Logger(WhatsAppWebhookService.name);

  constructor(
    private readonly senders: MessagingSenderRepository,
    private readonly inbound: MessagingInboundRepository,
    private readonly cloud: WhatsAppCloud,
    private readonly clock: Clock,
    private readonly arrivals: FlowArrivals,
    private readonly metrics: NotificationMetrics,
  ) {}

  async handle(batches: readonly InboundBatch[]): Promise<void> {
    for (const batch of batches) {
      const sender = await this.senders.findByProviderNumber(
        WHATSAPP_CLOUD_PROVIDER,
        batch.providerNumberId,
      );
      if (!sender) {
        this.logger.warn('Webhook event for a number that is no sender here; ignored');
        continue;
      }
      for (const receipt of batch.receipts) await this.onReceipt(sender, receipt);
      for (const message of batch.messages) await this.onMessage(sender, message);
    }
  }

  private async onReceipt(sender: MessagingSenderRecord, receipt: InboundReceipt): Promise<void> {
    // "sent" repeats what the send call already answered.
    if (receipt.status === 'sent') return;
    const failed = receipt.status === 'failed';
    const result = await this.inbound.recordReceipt({
      senderId: sender.id,
      eventId: `${receipt.messageId}:${receipt.status}`,
      providerMessageId: receipt.messageId,
      status: failed ? 'FAILED' : receipt.status === 'read' ? 'READ' : 'DELIVERED',
      errorCode: failed ? errorCodeForProviderCode(receipt.providerErrorCode) : null,
      person: { phone: receipt.recipientPhone, providerUserId: receipt.providerUserId },
    });
    if (result.kind === 'recorded') this.metrics.reported(result.written);
    if (result.kind === 'recorded' && result.arrival) {
      const { flowId, recipientUserId, channel } = result.arrival;
      await this.arrivals.arrived(flowId, recipientUserId, channel);
    }
  }

  private async onMessage(sender: MessagingSenderRecord, message: InboundMessage): Promise<void> {
    const person = { phone: message.phone, providerUserId: message.providerUserId };
    if (message.intent === 'stop') {
      const stop = await this.inbound.recordPreference(
        sender.id,
        message.messageId,
        person,
        'STOP',
      );
      if (stop.changed) await this.reply(sender, stop.phone, STOP_CONFIRMATION);
      return;
    }
    if (message.intent === 'start') {
      const start = await this.inbound.recordPreference(
        sender.id,
        message.messageId,
        person,
        'START',
      );
      if (start.changed) {
        await this.reply(sender, start.phone, START_CONFIRMATION);
        return;
      }
      // START from a person who never stopped is an ordinary message.
    }
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: REPLY_DAY_TIMEZONE }).format(
      this.clock.now(),
    );
    const { reply } = await this.inbound.recordMessage(sender.id, message.messageId, person, day);
    if (reply) await this.reply(sender, message.phone, AUTO_REPLY);
  }

  /** A reply that cannot be sent is dropped: the stored result must not depend on it. */
  private async reply(
    sender: MessagingSenderRecord,
    phone: string | null,
    text: string,
  ): Promise<void> {
    if (phone === null || sender.status !== 'ACTIVE') return;
    try {
      await this.cloud.client.sendText(this.cloud.open(sender), phone, text);
    } catch (err) {
      if (!(err instanceof ChannelAdapterError)) throw err;
      this.logger.warn(`Reply through sender ${sender.id} failed: ${err.code}`);
    }
  }
}
