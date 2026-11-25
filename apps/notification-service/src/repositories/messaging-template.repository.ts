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
export const TEMPLATE_PROBLEMS = [
  'REJECTED',
  'PAUSED',
  'DISABLED',
  'CATEGORY_CHANGED',
  'OUT_OF_STEP',
  // Waiting for the provider's review for longer than a review takes
  'PENDING_LONG',
] as const;
export type TemplateProblem = (typeof TEMPLATE_PROBLEMS)[number];

/** One account's templates in each problem state. */
export type AccountTemplateProblems = { providerAccountId: string } & Record<
  TemplateProblem,
  number
>;

/** A review normally ends within a day; past this a waiting template needs a person. */
export const PENDING_LONG_HOURS = 48;

/** Template rows (ROV-333), read and written as the platform role with no caller. */
export abstract class MessagingTemplateRepository {
  /** The account's rows of names the code still defines. */
  abstract listForAccount(providerAccountId: string): Promise<MessagingTemplateRecord[]>;

  /** Insert or replace by account, name and language, as the system; the row is not retired. */
  abstract upsert(rows: readonly MessagingTemplateRecord[]): Promise<void>;

  /**
   * Retires the account's rows whose name is not among `names` (the code's registry): a
   * reworded template has a new name, and the old row must stop counting as a problem.
   */
  abstract retireExcept(providerAccountId: string, names: readonly string[]): Promise<void>;

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

  /**
   * How many rows are in each problem state, for every account that has a live sender and at
   * least one row. Retired rows are not counted.
   */
  abstract countProblems(): Promise<AccountTemplateProblems[]>;
}
