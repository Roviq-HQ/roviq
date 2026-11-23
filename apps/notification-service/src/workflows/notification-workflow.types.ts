import type { NotificationChannel } from '@roviq/common-types';
import type { Audience } from '../repositories/types';
import type { RegularDigest, RegularMessage } from '../types/compose';
import type { RegularTypeKey } from '../types/registry';

export const NOTIFICATION_TASK_QUEUE = 'notifications';
export const DELIVERY_WORKFLOW_TYPE = 'NotificationDeliveryWorkflow';
export const DIGEST_WORKFLOW_TYPE = 'NotificationDigestWorkflow';
export const DIGEST_ITEM_SIGNAL = 'digestItem';

export const CHANNEL_ACTIVITY_RETRY = {
  maximumAttempts: 5,
  initialInterval: '10 seconds',
  backoffCoefficient: 2,
} as const;

export interface ChannelPlan {
  channel: NotificationChannel;
  /** Institute setting; false records a `channel_disabled` skip. */
  enabled: boolean;
}

/** Never carries an address or a secret; addresses are read inside the activity. */
interface RecipientTarget {
  audience: Audience;
  recipientUserId: string;
}

export interface DeliveryWorkflowInput extends RecipientTarget {
  message: RegularMessage<RegularTypeKey>;
  notificationId: string | null;
  channels: ChannelPlan[];
  data: Record<string, string>;
}

export interface DigestWorkflowInput extends RecipientTarget {
  type: RegularTypeKey;
  channels: ChannelPlan[];
  /** ISO time of the first run, computed by the caller from the cron in the institute's timezone. */
  runAt: string;
}

export interface DigestItem {
  /** Same key as the in-app row; a redelivered event is collected once. */
  dedupeKey: string;
  message: RegularMessage<RegularTypeKey>;
  /** ISO time the window this item belongs to closes. */
  runAt: string;
}

export interface SendChannelInput extends RecipientTarget {
  channel: NotificationChannel;
  enabled: boolean;
  content:
    | { kind: 'single'; message: RegularMessage<RegularTypeKey>; notificationId: string | null }
    | { kind: 'digest'; digest: RegularDigest<RegularTypeKey> };
  data: Record<string, string>;
  /** False on the workflow's last try: a deferral is then recorded as skipped instead. */
  deferrable: boolean;
}

/** Quiet hours or a full sender: the workflow sleeps until `deferUntil` and tries again. */
export interface ChannelDeferral {
  deferUntil: string;
}

export interface NotificationActivities {
  /**
   * One delivery row per execution (none for a deferral); throws on a provider failure so
   * Temporal retries.
   */
  sendChannel(input: SendChannelInput): Promise<'SENT' | 'SKIPPED' | ChannelDeferral>;
}

/** How often a channel may be deferred; the try after the last one sends or records a skip. */
export const MAX_CHANNEL_DEFERRALS = 30;

export const deliveryWorkflowId = (dedupeKey: string) => `notification-delivery:${dedupeKey}`;

export const digestWorkflowId = (tenantId: string, recipientUserId: string, type: RegularTypeKey) =>
  `notification-digest:${tenantId}:${recipientUserId}:${type}`;
