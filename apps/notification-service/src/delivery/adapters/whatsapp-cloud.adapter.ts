import type { WhatsAppCloud } from '../whatsapp/whatsapp-cloud';
import { WHATSAPP_CLOUD_PROVIDER } from '../whatsapp/whatsapp-cloud.client';
import type { ChannelAdapter, ChannelMessage, ChannelSendResult } from './channel-adapter';

/** Sends an approved template through the sender chosen for the message. */
export class WhatsAppCloudAdapter implements ChannelAdapter {
  readonly channel = 'WHATSAPP';
  readonly provider = WHATSAPP_CLOUD_PROVIDER;
  readonly usesSenders = true;

  constructor(private readonly cloud: WhatsAppCloud) {}

  async send(message: ChannelMessage): Promise<ChannelSendResult> {
    const [to] = message.to;
    if (!message.route || !to) {
      // The sender resolves both before calling; reaching here is a bug, not a provider failure.
      throw new Error('WhatsApp message without a sender, a template or an address');
    }
    const { sender, template } = message.route;
    const providerMessageId = await this.cloud.client.sendTemplate(
      this.cloud.open(sender),
      to,
      template,
    );
    return providerMessageId === null ? {} : { providerMessageId };
  }
}
