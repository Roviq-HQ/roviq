import type { NotificationChannel, NotificationTypeKey } from '@roviq/common-types';
import type { MessagingSenderRecord } from '../../repositories/types';
import type { TemplateSend } from '../whatsapp/whatsapp-template';

export interface ChannelMessage {
  channel: NotificationChannel;
  type: NotificationTypeKey;
  recipientUserId: string;
  /** One address, or for push every device token of the recipient. */
  to: readonly string[];
  subject: string;
  body: string;
  data: Record<string, string>;
  /** Set by the sender for an adapter with `usesSenders`: the number to send from and the template. */
  route?: { sender: MessagingSenderRecord; template: TemplateSend };
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
    /** False when the same request would be refused again. */
    readonly retryable = true,
  ) {
    super(message);
    this.name = 'ChannelAdapterError';
  }
}

export interface ChannelAdapter {
  readonly channel: NotificationChannel;
  /** Stored in `notification_deliveries.provider`. */
  readonly provider: string;
  /**
   * True when a message goes out through a `messaging_senders` row and an approved template:
   * the sender then resolves both and applies the opt-out, quiet-hours and cap rules.
   */
  readonly usesSenders?: boolean;
  /** Rejects with a ChannelAdapterError when the provider refuses or cannot be reached. */
  send(message: ChannelMessage): Promise<ChannelSendResult>;
}
