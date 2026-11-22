import type { MembershipRecord, Recipient } from './types';

/**
 * Tenant-scoped reads that resolve who an event is for. Every read runs as the event's
 * institute, so an id from another institute resolves to nothing.
 */
export abstract class RecipientReadRepository {
  /** Active guardians linked to the student with this membership id. */
  abstract findStudentGuardians(
    tenantId: string,
    studentMembershipId: string,
  ): Promise<Recipient[]>;
  abstract findMembership(tenantId: string, membershipId: string): Promise<MembershipRecord | null>;
  abstract findInstituteTimezone(tenantId: string): Promise<string | null>;
}
