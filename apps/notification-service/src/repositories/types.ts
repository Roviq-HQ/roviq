import type {
  MessageTemplateCategory,
  MessagingSenderStatus,
  NotificationChannel,
  NotificationSkipReason,
  NotificationTypeKey,
} from '@roviq/common-types';

export interface NotificationConfigRecord {
  inAppEnabled: boolean;
  whatsappEnabled: boolean;
  emailEnabled: boolean;
  pushEnabled: boolean;
  digestEnabled: boolean;
  digestCron: string | null;
}

export interface SubscriptionDetails {
  subscriptionId: string;
  instituteId: string;
  instituteName: string;
  planName: string;
  planAmount: number;
  planCurrency: string;
}

export interface UserIdRecord {
  id: string;
}

/** Where a notification belongs; mirrors the scope CHECK on both notification tables. */
export type Audience =
  | { scope: 'institute'; tenantId: string; resellerId: null }
  | { scope: 'reseller'; tenantId: null; resellerId: string }
  | { scope: 'platform'; tenantId: null; resellerId: null };

export interface Recipient {
  userId: string;
  /** Membership the in-app row is shown in; null shows it in every membership. */
  membershipId: string | null;
}

/** A guardian linked to a student, with what places them in the alert order. */
export interface GuardianRecord extends Recipient {
  isStaff: boolean;
  isPrimaryContact: boolean;
}

export interface MembershipRecord {
  userId: string;
  isStudent: boolean;
}

export interface ContactRecord {
  email: string;
  /** Primary phone with country code, e.g. '+919876543210'. */
  phone: string | null;
  preferredLocale: string | null;
}

export interface InAppRow {
  audience: Audience;
  recipient: Recipient;
  type: NotificationTypeKey;
  title: Record<string, string>;
  body: Record<string, string>;
  data: Record<string, string | number | null>;
  dedupeKey: string;
  /** The flow workflow that walks this notification; null when none does (a digest). */
  flowId: string | null;
}

/** The sender and template a WhatsApp attempt went through; stored on its delivery row. */
export interface DeliveryRoute {
  senderId: string;
  templateCategory: MessageTemplateCategory | null;
}

export type DeliveryOutcome =
  | { status: 'SENT'; provider: string; providerMessageId: string | null; route?: DeliveryRoute }
  | {
      status: 'FAILED';
      provider: string;
      errorCode: string;
      /** False when trying again cannot help (a refused template, a number not on WhatsApp). */
      retryable: boolean;
      route?: DeliveryRoute;
    }
  | { status: 'SKIPPED'; provider: string | null; skipReason: NotificationSkipReason };

/** A sender with its encrypted access token. Never leaves the notification service. */
export interface MessagingSenderRecord {
  id: string;
  scope: string;
  tenantId: string | null;
  status: MessagingSenderStatus;
  providerNumberId: string;
  dailyCap: number;
  instituteDailyCap: number | null;
  accessTokenEncrypted: Buffer;
}

export interface SenderSentCounts {
  total: number;
  forTenant: number;
}

export interface DeliveryRow {
  audience: Audience;
  notificationId: string | null;
  recipientUserId: string;
  type: NotificationTypeKey;
  channel: NotificationChannel;
  attempt: number;
  outcome: DeliveryOutcome;
  /** The workflow whose arrival a report of this row signals; null for none. */
  flowId: string | null;
}

/** Who an inbound event is about: a phone number, the provider's user id, or both. */
export interface InboundPerson {
  phone: string | null;
  providerUserId: string | null;
}

export interface ReceiptInput {
  senderId: string;
  /** Unique per report: the message id and the reported status. */
  eventId: string;
  providerMessageId: string;
  status: 'DELIVERED' | 'FAILED';
  /** Set for FAILED. */
  errorCode: string | null;
  /** A read report: append DELIVERED only when no delivery report came before it. */
  onlyIfNotDelivered: boolean;
  person: InboundPerson;
}

/** A message of a flow confirmed delivered: the flow's workflow is told. */
export interface FlowArrivalRecord {
  flowId: string;
  recipientUserId: string;
  channel: NotificationChannel;
}

/**
 * `recorded`: a row was appended (or a read report found one already there); `arrival` is set
 * when the appended row is a DELIVERED one of a flow. `duplicate`: handled before.
 * `unknown_message`: no such message was sent; nothing is written.
 */
export type ReceiptResult =
  | { kind: 'recorded'; arrival: FlowArrivalRecord | null }
  | { kind: 'duplicate' }
  | { kind: 'unknown_message' };

/** A delivery report from a provider that has no sender rows (SMS). */
export interface ProviderReceipt {
  provider: string;
  providerMessageId: string;
  status: 'DELIVERED' | 'FAILED';
  /** Set for FAILED. */
  errorCode: string | null;
}
