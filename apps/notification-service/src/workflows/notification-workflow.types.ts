import type { NotificationChannel, NotificationSkipReason } from '@roviq/common-types';
import type { DeferReason } from '../delivery/channel-gate';
import type { Audience } from '../repositories/types';
import type { RegularDigest, RegularMessage } from '../types/compose';
import type { NotificationFlow } from '../types/flow';
import type { RegularTypeKey } from '../types/registry';

export const NOTIFICATION_TASK_QUEUE = 'notifications';
export const FLOW_WORKFLOW_TYPE = 'NotificationFlowWorkflow';
export const DIGEST_WORKFLOW_TYPE = 'NotificationDigestWorkflow';
export const DIGEST_ITEM_SIGNAL = 'digestItem';
export const FLOW_ARRIVAL_SIGNAL = 'flowArrival';
export const CANARY_WORKFLOW_TYPE = 'DeliveryCanaryWorkflow';
export const TEMPLATE_SYNC_WORKFLOW_TYPE = 'WhatsAppTemplateSyncWorkflow';
export const TEMPLATE_SYNC_REQUESTED_SIGNAL = 'templateSyncRequested';
/**
 * While a template waits for the provider's review, its list is read again after each of these:
 * a provider event that never arrived must not leave a template waiting for good.
 */
export const TEMPLATE_RECHECK_WAITS_MS = [2, 10, 60, 360, 1440, 1440].map((m) => m * 60_000);
/** One run per provider account at a time. */
export const templateSyncWorkflowId = (accountId: string) => `whatsapp-template-sync:${accountId}`;

export const CHANNEL_ACTIVITY_RETRY = {
  maximumAttempts: 5,
  initialInterval: '10 seconds',
  backoffCoefficient: 2,
} as const;

/** Where a flow's recipients came from; the send re-checks it so a removed one is not sent to. */
export type RecipientsRef = { kind: 'guardians_of_student'; studentMembershipId: string } | null;

/** One recipient of a flow: ids only. */
export interface FlowRecipient {
  userId: string;
  /** Their in-app row; null when none was written. */
  notificationId: string | null;
}

/** Proof that a message reached a recipient of the flow. */
export interface FlowArrival {
  recipientUserId: string;
  via: NotificationChannel | 'IN_APP';
}

/** Never carries an address, a name or a secret; addresses are read inside the activity. */
export interface FlowWorkflowInput {
  /** The workflow id; stored on every delivery row so reports can find the flow. */
  flowId: string;
  audience: Audience;
  message: RegularMessage<RegularTypeKey>;
  /** In alert order. */
  recipients: FlowRecipient[];
  recipientsRef: RecipientsRef;
  flow: NotificationFlow;
  /** Institute settings per channel; false records a `channel_disabled` skip. */
  enabled: Record<NotificationChannel, boolean>;
  critical: boolean;
  /** Push payload data: entity ids and the deep-link path. */
  data: Record<string, string>;
}

export interface DigestWorkflowInput {
  audience: Audience;
  recipientUserId: string;
  type: RegularTypeKey;
  flow: NotificationFlow;
  enabled: Record<NotificationChannel, boolean>;
  critical: boolean;
  /** A guardian after the first: the summary goes by the app alone, without paid channels or email. */
  appOnly: boolean;
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

export interface SendChannelInput {
  audience: Audience;
  recipientUserId: string;
  channel: NotificationChannel;
  enabled: boolean;
  content:
    | { kind: 'single'; message: RegularMessage<RegularTypeKey>; notificationId: string | null }
    | { kind: 'digest'; digest: RegularDigest<RegularTypeKey> };
  data: Record<string, string>;
  /** False on the workflow's last try: a deferral is then recorded as skipped instead. */
  deferrable: boolean;
  /** Stored on the delivery row; null when no workflow waits for arrival. */
  flowId: string | null;
  recipientsRef: RecipientsRef;
}

export interface RecordSkipInput {
  audience: Audience;
  recipientUserId: string;
  notificationId: string | null;
  type: RegularTypeKey;
  channel: NotificationChannel;
  reason: NotificationSkipReason;
  flowId: string | null;
}

/** Quiet hours, a full or slowed sender, a paused provider: sleep until `deferUntil`, try again. */
export interface ChannelDeferral {
  deferUntil: string;
  reason: DeferReason;
}

/** Deferrals that come from sending speed or a provider pause, counted apart from the others. */
export const HELD_DEFER_REASONS: readonly DeferReason[] = ['rate_limited', 'provider_paused'];

export interface CanaryWorkflowInput {
  /** Each is asked for one test message, in order. */
  channels: NotificationChannel[];
}

export interface CanaryRequest {
  channel: NotificationChannel;
  /** ISO time of the scheduled run; the message shows it. */
  requestedAt: string;
}

export interface TemplateSyncInput {
  /** The provider account whose templates are brought in line with the registry. */
  providerAccountId: string;
}

export interface TemplateSyncOutcome {
  /** Templates still waiting for the provider's review. */
  pending: number;
}

export interface NotificationActivities {
  /**
   * One delivery row per execution (none for a deferral); throws on a provider failure so
   * Temporal retries.
   */
  sendChannel(input: SendChannelInput): Promise<'SENT' | 'SKIPPED' | ChannelDeferral>;
  /** One SKIPPED delivery row for a channel the flow did not try. */
  recordSkip(input: RecordSkipInput): Promise<void>;
  /** Publishes one canary request on the NOTIFICATION stream; the listener sends it. */
  requestCanary(input: CanaryRequest): Promise<void>;
  /** Submits the registry's missing templates and records what the provider holds (ROV-333). */
  syncWhatsAppTemplates(input: TemplateSyncInput): Promise<TemplateSyncOutcome>;
}

/** How often a channel may be deferred; the try after the last one sends or records a skip. */
export const MAX_CHANNEL_DEFERRALS = 30;
/**
 * How often a channel may be held by the sender's rate or a paused provider. A busy sender holds
 * a message for seconds, an open breaker for a minute at a time: this covers about 8 hours of a
 * provider outage while the workflow's history stays small.
 */
export const MAX_HELD_DEFERRALS = 480;

/** The data a send carries; a push also carries its notification id so a device can acknowledge it. */
export function sendData(
  data: Record<string, string>,
  channel: NotificationChannel,
  notificationId: string | null,
): Record<string, string> {
  return channel === 'PUSH' && notificationId !== null ? { ...data, notificationId } : data;
}

export const flowWorkflowId = (eventKey: string) => `notification-flow:${eventKey}`;

export const digestWorkflowId = (tenantId: string, recipientUserId: string, type: RegularTypeKey) =>
  `notification-digest:${tenantId}:${recipientUserId}:${type}`;
