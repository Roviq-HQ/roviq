import { Injectable, Logger } from '@nestjs/common';
import type { JetStreamContext } from '@roviq/nats-jetstream';
import { RecipientReadRepository } from '../repositories/recipient-read.repository';
import type { Audience, Recipient } from '../repositories/types';
import type { EventSource } from './notification-dispatcher.service';

export const instituteAudience = (tenantId: string): Audience => ({
  scope: 'institute',
  tenantId,
  resellerId: null,
});

export const PLATFORM_AUDIENCE: Audience = { scope: 'platform', tenantId: null, resellerId: null };

export function sourceOf(ctx: JetStreamContext): EventSource {
  return { stream: ctx.getStream(), sequence: ctx.getSequence().stream };
}

/** One guardian of a student, in alert order. */
export interface GuardianTarget {
  recipient: Recipient;
  /** True for every guardian after the first: they get the app copy, not a paid message. */
  appOnly: boolean;
}

export interface ResolvedMember {
  recipient: Recipient;
  isStudent: boolean;
}

/**
 * Turns the membership ids events carry into recipients, reading as the event's institute:
 * an id that belongs to another institute resolves to nothing.
 */
@Injectable()
export class RecipientResolver {
  private readonly logger = new Logger(RecipientResolver.name);

  constructor(private readonly repo: RecipientReadRepository) {}

  /**
   * A student's guardians in alert order (ROV-328): the one who is staff of the institute, else
   * the primary contact, then the others. Only the first is sent WhatsApp, SMS and email.
   */
  async guardiansOfStudent(
    tenantId: string,
    studentMembershipId: string,
  ): Promise<GuardianTarget[]> {
    const guardians = await this.repo.findStudentGuardians(tenantId, studentMembershipId);
    if (guardians.length > 0 && !guardians.some((guardian) => guardian.isPrimaryContact)) {
      this.logger.warn(
        `Student membership "${studentMembershipId}" in institute "${tenantId}" has no primary guardian; using the earliest link`,
      );
    }
    return guardians.map((guardian, index) => ({
      recipient: { userId: guardian.userId, membershipId: guardian.membershipId },
      appOnly: index > 0,
    }));
  }

  async member(tenantId: string, membershipId: string): Promise<ResolvedMember | null> {
    const found = await this.repo.findMembership(tenantId, membershipId);
    if (!found) return null;
    return { recipient: { userId: found.userId, membershipId }, isStudent: found.isStudent };
  }
}
