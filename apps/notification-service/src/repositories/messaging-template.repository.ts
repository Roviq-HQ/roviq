import type { MessageTemplateCategory, MessageTemplateStatus } from '@roviq/common-types';

/** What the system knows of one template in one language at one provider account. */
export interface MessagingTemplateRecord {
  providerAccountId: string;
  name: string;
  language: string;
  declaredCategory: MessageTemplateCategory;
  approvedCategory: MessageTemplateCategory | null;
  contentHash: string;
  providerTemplateId: string | null;
  status: MessageTemplateStatus;
  rejectedReason: string | null;
  quality: string | null;
  suggestedCategory: string | null;
  outOfStep: boolean;
}

/** A provider event's change to one row; absent fields stay as they are. */
export type TemplateEventChange = Partial<
  Pick<
    MessagingTemplateRecord,
    | 'status'
    | 'approvedCategory'
    | 'rejectedReason'
    | 'quality'
    | 'suggestedCategory'
    | 'outOfStep'
    | 'providerTemplateId'
  >
>;

/** Why a template cannot be sent, as the state gauge counts it. */
export type TemplateProblem =
  | 'REJECTED'
  | 'PAUSED'
  | 'DISABLED'
  | 'CATEGORY_CHANGED'
  | 'OUT_OF_STEP';

/** Template rows (ROV-333), read and written as the platform role with no caller. */
export abstract class MessagingTemplateRepository {
  abstract listForAccount(providerAccountId: string): Promise<MessagingTemplateRecord[]>;

  /** Insert or replace by account, name and language, as the system. */
  abstract upsert(rows: readonly MessagingTemplateRecord[]): Promise<void>;

  /**
   * Applies a provider event to an existing row; false when the system holds no such row (an
   * event for a template it never registered changes nothing).
   */
  abstract applyEvent(
    providerAccountId: string,
    name: string,
    language: string,
    change: TemplateEventChange,
  ): Promise<boolean>;

  /** The row a send checks; null when the template is not registered for the account. */
  abstract find(
    providerAccountId: string,
    name: string,
    language: string,
  ): Promise<MessagingTemplateRecord | null>;

  /** How many rows are in each problem state, over every account. */
  abstract countProblems(): Promise<Array<{ problem: TemplateProblem; count: number }>>;
}
