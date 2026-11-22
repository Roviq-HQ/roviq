import type { NotificationChannel, NotificationTypeKey } from '@roviq/common-types';

export interface ChannelMessage {
  channel: NotificationChannel;
  type: NotificationTypeKey;
  recipientUserId: string;
  /** One address, or for push every device token of the recipient. */
  to: readonly string[];
  subject: string;
  body: string;
  data: Record<string, string>;
}

export interface ChannelSendResult {
  providerMessageId?: string;
}

/**
 * A failed send. `code` is short and stable (stored in `notification_deliveries.error_code`);
 * the provider's own message text never goes in it.
 */
export class ChannelAdapterError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ChannelAdapterError';
  }
}

export interface ChannelAdapter {
  readonly channel: NotificationChannel;
  /** Stored in `notification_deliveries.provider`. */
  readonly provider: string;
  /** Rejects with a ChannelAdapterError when the provider refuses or cannot be reached. */
  send(message: ChannelMessage): Promise<ChannelSendResult>;
}
