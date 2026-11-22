import type {
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
}

export type DeliveryOutcome =
  | { status: 'SENT'; provider: string; providerMessageId: string | null }
  | { status: 'FAILED'; provider: string; errorCode: string }
  | { status: 'SKIPPED'; provider: string | null; skipReason: NotificationSkipReason };

export interface DeliveryRow {
  audience: Audience;
  notificationId: string | null;
  recipientUserId: string;
  type: NotificationTypeKey;
  channel: NotificationChannel;
  attempt: number;
  outcome: DeliveryOutcome;
}
