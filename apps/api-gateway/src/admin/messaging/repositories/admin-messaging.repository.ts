import type { MessagingSenderStatus, PlatformContext } from '@roviq/common-types';
import type {
  MessagingSenderRecord,
  MessagingTemplateRecord,
  RegisterMessagingSenderData,
  RegisterMessagingSenderResult,
  SmsUsageRecord,
  UpdateMessagingSenderData,
  WhatsAppUsageRecord,
} from './types';

export abstract class AdminMessagingRepository {
  /** Every live sender, the platform's first. */
  abstract list(ctx: PlatformContext): Promise<MessagingSenderRecord[]>;
  abstract findById(ctx: PlatformContext, id: string): Promise<MessagingSenderRecord | null>;
  /** Writes the sender and its encrypted token together; a unique index decides a duplicate. */
  abstract register(
    ctx: PlatformContext,
    data: RegisterMessagingSenderData,
  ): Promise<RegisterMessagingSenderResult>;
  /** Null when the sender is missing or deleted. */
  abstract update(
    ctx: PlatformContext,
    id: string,
    data: UpdateMessagingSenderData,
  ): Promise<MessagingSenderRecord | null>;
  /** Replaces (or first stores) the encrypted token. Null when the sender is missing or deleted. */
  abstract replaceToken(
    ctx: PlatformContext,
    id: string,
    accessTokenEncrypted: Buffer,
  ): Promise<MessagingSenderRecord | null>;
  /** Null when the sender is missing, deleted, or no longer in status `from`. */
  abstract setStatus(
    ctx: PlatformContext,
    id: string,
    from: MessagingSenderStatus,
    to: MessagingSenderStatus,
  ): Promise<MessagingSenderRecord | null>;
  /** Soft-deletes the sender and hard-deletes its token. False when it is missing or deleted. */
  abstract delete(ctx: PlatformContext, id: string): Promise<boolean>;
  /**
   * SENT WhatsApp deliveries in calendar month `month` (YYYY-MM, India time), per institute and
   * category; delivery canary rows are not usage.
   */
  abstract whatsAppUsage(ctx: PlatformContext, month: string): Promise<WhatsAppUsageRecord[]>;
  /**
   * SENT SMS deliveries in calendar month `month` (YYYY-MM, India time), per institute and type;
   * delivery canary rows are not usage.
   */
  abstract smsUsage(ctx: PlatformContext, month: string): Promise<SmsUsageRecord[]>;

  /** The sender's stored token, encrypted; null when the sender is gone. Never returned by the API. */
  abstract findTokenEncrypted(ctx: PlatformContext, id: string): Promise<Buffer | null>;

  /** The template rows of one provider account (ROV-333), by name then language. */
  abstract listTemplates(
    ctx: PlatformContext,
    providerAccountId: string,
  ): Promise<MessagingTemplateRecord[]>;
}
