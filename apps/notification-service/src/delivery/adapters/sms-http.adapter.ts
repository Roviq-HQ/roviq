import type { SmsHttp } from '../sms/sms-http';
import { SMS_HTTP_PROVIDER } from '../sms/sms-http.client';
import type { SmsDraft, SmsSend } from '../sms/sms-template';
import type { ChannelAdapter, ChannelMessage, ChannelSendResult } from './channel-adapter';

/** Sends only registered SMS templates; a draft without a registration is never sent. */
export class SmsHttpAdapter implements ChannelAdapter {
  readonly channel = 'SMS';
  readonly provider = SMS_HTTP_PROVIDER;

  constructor(private readonly sms: SmsHttp) {}

  resolveSmsTemplate(draft: SmsDraft): SmsSend | null {
    const templateId = this.sms.registrations.idFor(draft.registrationKey);
    return templateId === null ? null : { ...draft, templateId };
  }

  async send(message: ChannelMessage): Promise<ChannelSendResult> {
    const [to] = message.to;
    if (!message.sms || !to) {
      // The sender resolves both before calling; reaching here is a bug, not a provider failure.
      throw new Error('SMS message without a registered template or an address');
    }
    return { providerMessageId: await this.sms.client.send(to, message.sms) };
  }
}
