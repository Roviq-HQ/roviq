import { Injectable } from '@nestjs/common';
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
  constructor(private readonly repo: RecipientReadRepository) {}

  guardiansOfStudent(tenantId: string, studentMembershipId: string): Promise<Recipient[]> {
    return this.repo.findStudentGuardians(tenantId, studentMembershipId);
  }

  async member(tenantId: string, membershipId: string): Promise<ResolvedMember | null> {
    const found = await this.repo.findMembership(tenantId, membershipId);
    if (!found) return null;
    return { recipient: { userId: found.userId, membershipId }, isStudent: found.isStudent };
  }
}
