import { Inject, Injectable } from '@nestjs/common';
import {
  consentRecords,
  DRIZZLE_DB,
  type DrizzleDB,
  guardianProfilesLive,
  mkInstituteCtx,
  studentProfilesLive,
  withTenant,
} from '@roviq/database';
import { and, desc, eq, inArray } from 'drizzle-orm';
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
    purpose: string;
  }): Promise<GuardianConsentState> {
    return withTenant(this.db, mkInstituteCtx(query.tenantId, ORIGIN), async (tx) => {
      const guardians = await tx
        .select({ id: guardianProfilesLive.id })
        .from(guardianProfilesLive)
        .where(eq(guardianProfilesLive.userId, query.recipientUserId));
      if (guardians.length === 0) return 'not_guardian';
      const guardianIds = guardians.map((g) => g.id);

      let studentProfileId: string | null = null;
      if (query.studentMembershipId) {
        const [student] = await tx
          .select({ id: studentProfilesLive.id })
          .from(studentProfilesLive)
          .where(eq(studentProfilesLive.membershipId, query.studentMembershipId))
          .limit(1);
        // A student this institute does not have: nothing can have been consented to.
        if (!student) return 'missing';
        studentProfileId = student.id;
      }

      // Append-only table: the latest row of each (guardian, student) pair is its state.
      const latest = await tx
        .selectDistinctOn([consentRecords.guardianProfileId, consentRecords.studentProfileId], {
          isGranted: consentRecords.isGranted,
        })
        .from(consentRecords)
        .where(
          and(
            inArray(consentRecords.guardianProfileId, guardianIds),
            eq(consentRecords.purpose, query.purpose),
            studentProfileId ? eq(consentRecords.studentProfileId, studentProfileId) : undefined,
          ),
        )
        .orderBy(
          consentRecords.guardianProfileId,
          consentRecords.studentProfileId,
          desc(consentRecords.createdAt),
          desc(consentRecords.id),
        );

      if (latest.length === 0) return 'missing';
      return latest.some((row) => row.isGranted) ? 'granted' : 'withdrawn';
    });
  }
}
