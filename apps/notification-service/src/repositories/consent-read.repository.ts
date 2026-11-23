/**
 * `granted` / `withdrawn` / `missing` describe the latest consent row; `not_guardian` means the
 * recipient has no guardian profile in the institute, so guardian consent does not apply.
 */
export type GuardianConsentState = 'granted' | 'withdrawn' | 'missing' | 'not_guardian';

export abstract class ConsentReadRepository {
  /**
   * A guardian's consent for one purpose, from the latest row of each (guardian, student) pair.
   * With a student: that pair decides. Without one: every student linked to the guardian must
   * be granted, so consent for one child never covers a message about another.
   */
  abstract guardianConsent(query: {
    tenantId: string;
    recipientUserId: string;
    /** Membership id of the student the message is about, when it is about one. */
    studentMembershipId: string | null;
    purpose: string;
  }): Promise<GuardianConsentState>;
}
