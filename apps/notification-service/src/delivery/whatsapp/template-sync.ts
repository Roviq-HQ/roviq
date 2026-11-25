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
  at: Pick<ProviderTemplate, 'id' | 'status' | 'category' | 'rejectedReason' | 'quality'> & {
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
    const result: TemplateSyncResult = { created: 0, known: 0, refused: 0, noSender: false };
    const sender = await this.senders.findForAccount(accountId);
    if (sender === null) return { ...result, noSender: true };

    const breakerName = senderBreakerName(sender.id);
    const allowed = await this.breaker.allow(breakerName);
    if (!allowed.ok) throw new TemplateSyncPausedError(allowed.retryAt);
    const { accessToken } = this.open(sender);

    const held = await this.guarded(breakerName, () => this.client.list(accountId, accessToken));
    const rows: MessagingTemplateRecord[] = [];
    try {
      for (const s of registrySubmissions(portal)) {
        const at = held.find((p) => p.name === s.name && p.language === s.language);
        if (at) {
          const outOfStep =
            (at.body !== null && at.body !== s.body) ||
            (at.buttonLabel !== null && at.buttonLabel !== s.buttonLabel);
          rows.push(rowOf(accountId, s, { ...at, outOfStep }));
          result.known += 1;
          continue;
        }
        try {
          const created = await this.guarded(breakerName, () =>
            this.client.create(accountId, accessToken, s),
          );
          rows.push(
            rowOf(accountId, s, {
              ...created,
              rejectedReason: null,
              quality: null,
              outOfStep: false,
            }),
          );
          result.created += 1;
        } catch (err) {
          if (!(err instanceof ChannelAdapterError)) throw err;
          // Listed again on the next run.
          if (err.code === 'WA_TEMPLATE_EXISTS') continue;
          if (err.code !== 'WA_TEMPLATE_INVALID') throw err;
          rows.push(
            rowOf(accountId, s, {
              id: '',
              status: 'REJECTED',
              category: null,
              rejectedReason: err.code,
              quality: null,
              outOfStep: false,
            }),
          );
          result.refused += 1;
        }
      }
    } finally {
      // What was learned is kept even when a later call failed.
      await this.templates.upsert(
        rows.map((r) => ({ ...r, providerTemplateId: r.providerTemplateId || null })),
      );
      for (const r of rows) this.sendability.forget(accountId, r.name, r.language);
    }
    return result;
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
