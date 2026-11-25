import { Injectable } from '@nestjs/common';
import { MESSAGING_SENDER_STATE_MACHINE, MessagingSenderStatus } from '@roviq/common-types';
import { MessagingSenderRepository } from '../../repositories/messaging-sender.repository';
import { RecipientReadRepository } from '../../repositories/recipient-read.repository';
import type { MessagingSenderRecord } from '../../repositories/types';
import type { SenderCapacity } from '../channel-gate';
import { quietHoursEnd } from './quiet-hours';
import { TemplateSendability } from './template-sendability';
import { WHATSAPP_CLOUD_PROVIDER } from './whatsapp-cloud.client';
import type { TemplateSend } from './whatsapp-template';

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long a critical message waits before the cap is looked at again. */
export const CAP_RETRY_MS = 60 * 60 * 1000;
const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/** The clock the rules read; a class so tests can set the time. */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}

/**
 * The rules of a WhatsApp send that depend on the sender: which number, whether the person
 * asked it to stop, quiet hours, and the daily cap.
 */
@Injectable()
export class WhatsAppRoute {
  constructor(
    private readonly senders: MessagingSenderRepository,
    private readonly recipients: RecipientReadRepository,
    private readonly clock: Clock,
    private readonly templates: TemplateSendability,
  ) {}

  /**
   * The template as it may go out from this sender's account, under the category the provider
   * approved; null when the account has it unapproved, recategorised or not at all (ROV-333).
   * A sender without a known account cannot be checked, so nothing is sent through it.
   */
  async approvedTemplate(
    sender: MessagingSenderRecord,
    template: TemplateSend,
  ): Promise<TemplateSend | null> {
    if (sender.providerAccountId === null) return null;
    const state = await this.templates.check(
      sender.providerAccountId,
      template.name,
      template.languageCode,
    );
    return state.sendable ? { ...template, category: state.approvedCategory } : null;
  }

  /** The institute's own active sender, else the platform's. */
  resolveSender(tenantId: string | null): Promise<MessagingSenderRecord | null> {
    return this.senders.resolveForAudience(tenantId, 'WHATSAPP', WHATSAPP_CLOUD_PROVIDER);
  }

  /**
   * The platform's active sender when the institute's own cannot send now; null when the failed
   * sender is already the platform's or there is none.
   */
  async fallbackFor(failed: MessagingSenderRecord): Promise<MessagingSenderRecord | null> {
    if (failed.scope !== 'institute') return null;
    const platform = await this.senders.findActivePlatform('WHATSAPP', WHATSAPP_CLOUD_PROVIDER);
    return platform !== null && platform.id !== failed.id ? platform : null;
  }

  /**
   * The provider says the sender may not send: ACTIVE → BLOCKED, as the system. Only that
   * transition happens here; a platform admin reactivates it. False when it was not ACTIVE.
   */
  async block(sender: MessagingSenderRecord): Promise<boolean> {
    const from = MessagingSenderStatus.ACTIVE;
    const to = MessagingSenderStatus.BLOCKED;
    if (sender.status !== from || !MESSAGING_SENDER_STATE_MACHINE.canTransition(from, to)) {
      return false;
    }
    return this.senders.setStatusFrom(sender.id, from, to);
  }

  optedOut(sender: MessagingSenderRecord, phone: string): Promise<boolean> {
    return this.senders.isOptedOut(sender.id, phone);
  }

  /** Critical messages ignore quiet hours. Others wait until they end in the institute's timezone. */
  async quietUntil(tenantId: string | null, critical: boolean): Promise<Date | null> {
    if (critical) return null;
    const timezone =
      tenantId === null
        ? DEFAULT_TIMEZONE
        : ((await this.recipients.findInstituteTimezone(tenantId)) ?? DEFAULT_TIMEZONE);
    try {
      return quietHoursEnd(timezone, this.clock.now());
    } catch {
      // A stored timezone the runtime does not know must not stop the message.
      return quietHoursEnd(DEFAULT_TIMEZONE, this.clock.now());
    }
  }

  /**
   * Over the sender's cap, or over the institute's share of the platform's sender: a critical
   * message waits, any other is skipped. Counted over the last 24 hours, like the provider's limit.
   */
  async capacity(
    sender: MessagingSenderRecord,
    tenantId: string | null,
    critical: boolean,
  ): Promise<SenderCapacity> {
    const now = this.clock.now();
    const sent = await this.senders.countSentSince(
      sender.id,
      new Date(now.getTime() - DAY_MS),
      tenantId,
    );
    const overShare =
      sender.scope === 'platform' &&
      tenantId !== null &&
      sender.instituteDailyCap !== null &&
      sent.forTenant >= sender.instituteDailyCap;
    if (sent.total < sender.dailyCap && !overShare) return 'ok';
    return critical ? { deferUntil: new Date(now.getTime() + CAP_RETRY_MS) } : 'over';
  }
}
