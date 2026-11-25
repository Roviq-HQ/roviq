import { senderBreakerName } from '@roviq/redis';
import type { MessagingSenderRepository } from '../../repositories/messaging-sender.repository';
import type {
  MessagingTemplateRecord,
  MessagingTemplateRepository,
} from '../../repositories/messaging-template.repository';
import type { MessagingSenderRecord } from '../../repositories/types';
import { ChannelAdapterError } from '../adapters/channel-adapter';
import type { ProviderBreaker } from '../rate/provider-breaker';
import type { TemplateSendability } from './template-sendability';
import {
  publicPortalUrl,
  registrySubmissions,
  type TemplateSubmission,
} from './template-submission';
import type { CloudSender } from './whatsapp-cloud.client';
import type { ProviderTemplate, WhatsAppTemplateClient } from './whatsapp-template.client';

export interface TemplateSyncResult {
  /** Submitted to the provider in this run. */
  created: number;
  /** Already at the provider; their state was stored. */
  known: number;
  /** The provider refused the submission; stored as REJECTED with the code. */
  refused: number;
  /** Still waiting for the provider's review, or not read yet: the list is worth reading again. */
  pending: number;
  /** Nothing could be synced: the account has no live sender. */
  noSender: boolean;
}

/** The breaker of the sender used is open: try the whole sync again after `retryAt`. */
export class TemplateSyncPausedError extends Error {
  constructor(readonly retryAt: Date) {
    super(`The provider is paused for this account until ${retryAt.toISOString()}`);
    this.name = 'TemplateSyncPausedError';
  }
}

function rowOf(
  accountId: string,
  s: TemplateSubmission,
  at: Pick<ProviderTemplate, 'status' | 'category' | 'rejectedReason' | 'quality'> & {
    id: string | null;
    outOfStep: boolean;
  },
): MessagingTemplateRecord {
  return {
    providerAccountId: accountId,
    name: s.name,
    language: s.language,
    declaredCategory: s.category,
    // The provider's category is only settled once it has reviewed the template.
    approvedCategory: at.status === 'APPROVED' ? (at.category ?? s.category) : null,
    contentHash: s.contentHash,
    providerTemplateId: at.id,
    status: at.status,
    rejectedReason: at.rejectedReason,
    quality: at.quality,
    suggestedCategory: null,
    outOfStep: at.outOfStep,
  };
}

/**
 * Brings one provider account's templates in line with the code registry (ROV-333): a template
 * the provider does not hold in a language is submitted, one it holds is recorded as it stands.
 * Nothing is ever deleted or edited at the provider: a changed text is a new name.
 */
export class TemplateSync {
  constructor(
    private readonly senders: MessagingSenderRepository,
    private readonly templates: MessagingTemplateRepository,
    private readonly sendability: TemplateSendability,
    private readonly client: WhatsAppTemplateClient,
    private readonly open: (sender: MessagingSenderRecord) => CloudSender,
    private readonly breaker: ProviderBreaker,
    private readonly portalUrl: string | undefined,
  ) {}

  async sync(accountId: string): Promise<TemplateSyncResult> {
    // Before any call: a button the provider would refuse must not be submitted at all.
    const portal = publicPortalUrl(this.portalUrl);
    const result: TemplateSyncResult = {
      created: 0,
      known: 0,
      refused: 0,
      pending: 0,
      noSender: false,
    };
    const sender = await this.senders.findForAccount(accountId);
    if (sender === null) return { ...result, noSender: true };

    const breakerName = senderBreakerName(sender.id);
    const allowed = await this.breaker.allow(breakerName);
    if (!allowed.ok) throw new TemplateSyncPausedError(allowed.retryAt);
    const { accessToken } = this.open(sender);

    const submissions = registrySubmissions(portal);
    const held = await this.guarded(breakerName, () => this.client.list(accountId, accessToken));
    const known: MessagingTemplateRecord[] = [];
    const missing: TemplateSubmission[] = [];
    for (const s of submissions) {
      const at = held.find((p) => p.name === s.name && p.language === s.language);
      if (!at) {
        missing.push(s);
        continue;
      }
      const outOfStep =
        (at.body !== null && at.body !== s.body) ||
        (at.buttonLabel !== null && at.buttonLabel !== s.buttonLabel);
      known.push(rowOf(accountId, s, { ...at, outOfStep }));
    }
    // Stored at once, so a provider event that follows the list finds its row and is not
    // overwritten by an older reading.
    await this.store(known);
    await this.templates.retireExcept(accountId, [...new Set(submissions.map((s) => s.name))]);
    result.known = known.length;
    result.pending = known.filter((r) => r.status === 'PENDING').length;

    for (const s of missing) {
      try {
        const created = await this.guarded(breakerName, () =>
          this.client.create(accountId, accessToken, s),
        );
        // Before the next call: the provider's verdict can arrive within seconds.
        await this.store([
          rowOf(accountId, s, {
            ...created,
            rejectedReason: null,
            quality: null,
            outOfStep: false,
          }),
        ]);
        result.created += 1;
        if (created.status === 'PENDING') result.pending += 1;
      } catch (err) {
        if (!(err instanceof ChannelAdapterError)) throw err;
        if (err.code === 'WA_TEMPLATE_EXISTS') {
          // The list did not show it yet: read again later.
          result.pending += 1;
          continue;
        }
        if (err.code !== 'WA_TEMPLATE_INVALID') throw err;
        await this.store([
          rowOf(accountId, s, {
            id: null,
            status: 'REJECTED',
            category: null,
            rejectedReason: err.code,
            quality: null,
            outOfStep: false,
          }),
        ]);
        result.refused += 1;
      }
    }
    return result;
  }

  private async store(rows: readonly MessagingTemplateRecord[]): Promise<void> {
    await this.templates.upsert(rows);
    for (const r of rows) this.sendability.forget(r.providerAccountId, r.name, r.language);
  }

  /** A provider that cannot answer counts against the sender's breaker; one that answers clears it. */
  private async guarded<T>(breakerName: string, call: () => Promise<T>): Promise<T> {
    try {
      const value = await call();
      await this.breaker.succeeded(breakerName);
      return value;
    } catch (err) {
      if (err instanceof ChannelAdapterError && err.code === 'WA_UNREACHABLE') {
        await this.breaker.failed(breakerName);
      } else if (err instanceof ChannelAdapterError && err.code !== 'WA_RATE_LIMITED') {
        await this.breaker.succeeded(breakerName);
      }
      throw err;
    }
  }
}
