import type { MessageTemplateCategory, MessagingSenderStatus } from '@roviq/common-types';

/** A sender as the API returns it. The access token is deliberately not part of it. */
export interface MessagingSenderRecord {
  id: string;
  scope: 'platform' | 'institute';
  tenantId: string | null;
  providerNumberId: string;
  displayNumber: string;
  status: MessagingSenderStatus;
  dailyCap: number;
  instituteDailyCap: number | null;
  messagesPerSecond: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface RegisterMessagingSenderData {
  /** Null registers the platform's sender. */
  tenantId: string | null;
  providerNumberId: string;
  displayNumber: string;
  accessTokenEncrypted: Buffer;
  dailyCap: number;
  instituteDailyCap: number | null;
}

export type RegisterMessagingSenderResult =
  | { kind: 'ok'; sender: MessagingSenderRecord }
  | { kind: 'institute_not_found' }
  | { kind: 'sender_exists' };

export interface UpdateMessagingSenderData {
  displayNumber?: string;
  dailyCap?: number;
  /** Null clears the share limit. */
  instituteDailyCap?: number | null;
  messagesPerSecond?: number;
}

export interface WhatsAppUsageRecord {
  tenantId: string | null;
  templateCategory: MessageTemplateCategory | null;
  sentCount: number;
}

export interface SmsUsageRecord {
  tenantId: string | null;
  /** The notification type key. */
  type: string;
  sentCount: number;
}
