import type { GuardianRecord, MembershipRecord } from './types';

/**
 * Tenant-scoped reads that resolve who an event is for. Every read runs as the event's
 * institute, so an id from another institute resolves to nothing.
 */
export abstract class RecipientReadRepository {
  /**
   * Active guardians linked to the student with this membership id, in alert order: those who
   * are active staff of the institute, then the primary contact, then the rest by earliest link.
   */
  abstract findStudentGuardians(
    tenantId: string,
    studentMembershipId: string,
  ): Promise<GuardianRecord[]>;
  abstract findMembership(tenantId: string, membershipId: string): Promise<MembershipRecord | null>;
  abstract findInstituteTimezone(tenantId: string): Promise<string | null>;
  /** The institute's name in every locale it was entered in. */
  abstract findInstituteName(tenantId: string): Promise<Record<string, string> | null>;
}
