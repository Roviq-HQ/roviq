import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NotificationChannel } from '@roviq/common-types';
import type { ChannelAdapter, ChannelMessage, ChannelSendResult } from './channel-adapter';

/**
 * Dev and e2e stand-in for a real provider. Logs that a send happened and to whom (user id),
 * never the text or the address: a welcome message carries a temporary password.
 */
export class LogChannelAdapter implements ChannelAdapter {
  readonly provider = 'log';
  private readonly logger = new Logger(LogChannelAdapter.name);

  constructor(readonly channel: NotificationChannel) {}

  async send(message: ChannelMessage): Promise<ChannelSendResult> {
    const providerMessageId = `log-${randomUUID()}`;
    this.logger.log(
      `[${message.channel}] ${message.type} to user ${message.recipientUserId} (${providerMessageId})`,
    );
    return { providerMessageId };
  }
}
