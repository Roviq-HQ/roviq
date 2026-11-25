import type { MessageTemplateCategory } from '@roviq/common-types';
import { MessagingTemplateRepository } from '../../repositories/messaging-template.repository';

/** How long one process trusts a template's state before reading it again. */
export const SENDABILITY_TTL_MS = 30_000;

export type Sendability =
  | { sendable: true; approvedCategory: MessageTemplateCategory }
  | { sendable: false };

const keyOf = (account: string, name: string, language: string) =>
  `${account}\u0000${name}\u0000${language}`;

/**
 * Whether a template may be sent from an account: approved, and under the category its
 * definition declares (a recategorised template is not sent at the other price). Answers are
 * kept for a short time; a provider event received in this process drops the entry, and the
 * stored row stays the truth.
 */
export class TemplateSendability {
  private readonly cache = new Map<string, { at: number; answer: Sendability }>();

  constructor(
    private readonly templates: MessagingTemplateRepository,
    private readonly ttlMs = SENDABILITY_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  async check(account: string, name: string, language: string): Promise<Sendability> {
    const key = keyOf(account, name, language);
    const cached = this.cache.get(key);
    if (cached && this.now() - cached.at < this.ttlMs) return cached.answer;
    const row = await this.templates.find(account, name, language);
    const answer: Sendability =
      row?.status === 'APPROVED' && row.approvedCategory === row.declaredCategory
        ? { sendable: true, approvedCategory: row.approvedCategory }
        : { sendable: false };
    this.cache.set(key, { at: this.now(), answer });
    return answer;
  }

  forget(account: string, name: string, language: string): void {
    this.cache.delete(keyOf(account, name, language));
  }
}
