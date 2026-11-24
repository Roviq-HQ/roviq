import type {
  NotificationChannel,
  NotificationDeliveryState,
  NotificationTypeKey,
} from '@roviq/common-types';
import type { I18nContent } from '@roviq/database';

/** Filters as the repository applies them: module and criticality already turned into types. */
export interface DeliveryLogQuery {
  /** Rows of other types are left out; empty matches nothing. */
  types: readonly NotificationTypeKey[];
  channel: NotificationChannel | null;
  state: NotificationDeliveryState | null;
  studentId: string | null;
  sessionId: string | null;
  recipientUserId: string | null;
  from: Date | null;
  to: Date | null;
  notDeliveredOnly: boolean;
}

export interface DeliveryLogChannelRecord {
  channel: NotificationChannel;
  state: NotificationDeliveryState;
  reason: string | null;
  at: Date;
}

export interface DeliveryLogEntryRecord {
  /** Highest row id of the entry: its sort key and cursor. */
  lastRowId: string;
  /** Kind of message key and the key itself (a notification id, a flow id, …); never returned. */
  entryKey: string;
  type: NotificationTypeKey;
  at: Date;
  studentMembershipId: string | null;
  studentFirstName: I18nContent | null;
  studentLastName: I18nContent | null;
  recipientUserId: string;
  recipientFirstName: I18nContent | null;
  recipientLastName: I18nContent | null;
  relationship: string | null;
  channels: DeliveryLogChannelRecord[];
}

export interface DeliveryLogPage {
  entries: DeliveryLogEntryRecord[];
  totalCount: number;
  hasNextPage: boolean;
}
