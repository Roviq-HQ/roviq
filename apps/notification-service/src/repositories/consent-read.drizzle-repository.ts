import { Inject, Injectable } from '@nestjs/common';
import type { ConsentPurpose } from '@roviq/common-types';
import {
  consentRecords,
  DRIZZLE_DB,
  type DrizzleDB,
  guardianProfilesLive,
  mkInstituteCtx,
  studentGuardianLinksLive,
  studentProfilesLive,
  withTenant,
} from '@roviq/database';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { ConsentReadRepository, type GuardianConsentState } from './consent-read.repository';

const ORIGIN = 'repository:notification-consent';

@Injectable()
export class ConsentReadDrizzleRepository extends ConsentReadRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async guardianConsent(query: {
    tenantId: string;
    recipientUserId: string;
    studentMembershipId: string | null;
    purpose: ConsentPurpose;
  }): Promise<GuardianConsentState> {
    return withTenant(this.db, mkInstituteCtx(query.tenantId, ORIGIN), async (tx) => {
      const guardians = await tx
        .select({ id: guardianProfilesLive.id })
        .from(guardianProfilesLive)
        .where(eq(guardianProfilesLive.userId, query.recipientUserId));
      if (guardians.length === 0) return 'not_guardian';
      const guardianIds = guardians.map((g) => g.id);

      // The pairs that must all be granted: the named student, or every linked student when the
      // message names none, so consent for one child never covers a message about another.
      let studentIds: string[];
      if (query.studentMembershipId) {
        const [student] = await tx
          .select({ id: studentProfilesLive.id })
          .from(studentProfilesLive)
          .where(eq(studentProfilesLive.membershipId, query.studentMembershipId))
          .limit(1);
        // A student this institute does not have: nothing can have been consented to.
        if (!student) return 'missing';
        studentIds = [student.id];
      } else {
        const links = await tx
          .selectDistinct({ studentProfileId: studentGuardianLinksLive.studentProfileId })
          .from(studentGuardianLinksLive)
          .where(
            and(
              inArray(studentGuardianLinksLive.guardianProfileId, guardianIds),
              isNull(studentGuardianLinksLive.accessRevokedAt),
            ),
          );
        if (links.length === 0) return 'missing';
        studentIds = links.map((link) => link.studentProfileId);
      }

      // Append-only table: the latest row of each (guardian, student) pair is its state.
      const latest = await tx
        .selectDistinctOn([consentRecords.guardianProfileId, consentRecords.studentProfileId], {
          studentProfileId: consentRecords.studentProfileId,
          isGranted: consentRecords.isGranted,
        })
        .from(consentRecords)
        .where(
          and(
            inArray(consentRecords.guardianProfileId, guardianIds),
            eq(consentRecords.purpose, query.purpose),
            inArray(consentRecords.studentProfileId, studentIds),
          ),
        )
        .orderBy(
          consentRecords.guardianProfileId,
          consentRecords.studentProfileId,
          desc(consentRecords.createdAt),
          desc(consentRecords.id),
        );

      if (latest.some((row) => !row.isGranted)) return 'withdrawn';
      const granted = new Set(latest.map((row) => row.studentProfileId));
      return studentIds.every((id) => granted.has(id)) ? 'granted' : 'missing';
    });
  }
}
