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

/** Sent once when a person asks to stop. Both languages: the person's own is not known here. */
export const STOP_CONFIRMATION =
  'You will not get WhatsApp alerts from this number any more. Alerts stay available in the app.\n\n' +
  'अब आपको इस नंबर से व्हाट्सऐप सूचनाएँ नहीं मिलेंगी। सूचनाएँ ऐप में उपलब्ध रहेंगी।';

/** The one reply a day to anything else a person writes. */
export const AUTO_REPLY =
  'This number only sends alerts, and messages sent here are not read. Please contact your institute directly. Send STOP to stop these alerts.\n\n' +
  'यह नंबर केवल सूचनाएँ भेजता है और यहाँ भेजे गए संदेश पढ़े नहीं जाते। कृपया सीधे अपने संस्थान से संपर्क करें। ये सूचनाएँ बंद करने के लिए STOP भेजें।';

/** The day "one reply a day" is counted in. */
const REPLY_DAY_TIMEZONE = 'Asia/Kolkata';

/**
 * Acts on what the provider reports: delivery reports become delivery rows, a stop request
 * becomes an opt-out, anything else gets one fixed reply a day. Every step is safe to repeat,
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
    await this.inbound.recordReceipt({
      senderId: sender.id,
      eventId: `${receipt.messageId}:${receipt.status}`,
      providerMessageId: receipt.messageId,
      status: failed ? 'FAILED' : 'DELIVERED',
      errorCode: failed ? errorCodeForProviderCode(receipt.providerErrorCode) : null,
      onlyIfNotDelivered: receipt.status === 'read',
      person: { phone: receipt.recipientPhone, providerUserId: receipt.providerUserId },
    });
  }

  private async onMessage(sender: MessagingSenderRecord, message: InboundMessage): Promise<void> {
    const person = { phone: message.phone, providerUserId: message.providerUserId };
    if (message.stop) {
      const optOut = await this.inbound.recordOptOut(sender.id, message.messageId, person);
      if (optOut.created) await this.reply(sender, optOut.phone, STOP_CONFIRMATION);
      return;
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
