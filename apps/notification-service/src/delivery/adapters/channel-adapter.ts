import type { NotificationChannel, NotificationTypeKey } from '@roviq/common-types';
import type { MessagingSenderRecord } from '../../repositories/types';
import type { SmsDraft, SmsSend } from '../sms/sms-template';
import type { TemplateSend } from '../whatsapp/whatsapp-template';
import { type AdapterErrorCode, type FailureKind, failureKindOf } from './adapter-errors';

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
  /** Set by the sender for an adapter with `resolveSmsTemplate`: the registered template to send. */
  sms?: SmsSend;
}

export interface ChannelSendResult {
  providerMessageId?: string;
}

/**
 * A failed send. `code` is short and stable (stored in `notification_deliveries.error_code`);
 * the provider's own message text never goes in it.
 */
export class ChannelAdapterError extends Error {
  /** Whether another provider of the channel may take the same attempt. */
  readonly kind: FailureKind;

  constructor(
    readonly code: AdapterErrorCode,
    message: string,
    /** False when the same request would be refused again. */
    readonly retryable = true,
    /** How long the provider asked us to wait (its `Retry-After`); null when it did not say. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'ChannelAdapterError';
    this.kind = failureKindOf(code);
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
  /**
   * Present on an adapter that may send only registered SMS templates. Returns the draft with
   * its registration id, or null when none is configured: the send is then skipped
   * (`no_template`) instead of going out as free text.
   */
  resolveSmsTemplate?(draft: SmsDraft): SmsSend | null;
  /** Rejects with a ChannelAdapterError when the provider refuses or cannot be reached. */
  send(message: ChannelMessage): Promise<ChannelSendResult>;
}
