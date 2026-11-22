import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  guardianProfilesLive,
  institutesLive,
  membershipsLive,
  mkInstituteCtx,
  studentGuardianLinksLive,
  studentProfilesLive,
  withTenant,
} from '@roviq/database';
import { and, eq } from 'drizzle-orm';
import { RecipientReadRepository } from './recipient-read.repository';
import type { MembershipRecord, Recipient } from './types';

const ORIGIN = 'repository:notification-recipients';

@Injectable()
export class RecipientReadDrizzleRepository extends RecipientReadRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async findStudentGuardians(tenantId: string, studentMembershipId: string): Promise<Recipient[]> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), (tx) =>
      tx
        .select({
          userId: guardianProfilesLive.userId,
          membershipId: guardianProfilesLive.membershipId,
        })
        .from(studentProfilesLive)
        .innerJoin(
          studentGuardianLinksLive,
          eq(studentGuardianLinksLive.studentProfileId, studentProfilesLive.id),
        )
        .innerJoin(
          guardianProfilesLive,
          eq(guardianProfilesLive.id, studentGuardianLinksLive.guardianProfileId),
        )
        .innerJoin(membershipsLive, eq(membershipsLive.id, guardianProfilesLive.membershipId))
        .where(
          and(
            eq(studentProfilesLive.membershipId, studentMembershipId),
            eq(membershipsLive.status, 'ACTIVE'),
          ),
        )
        .orderBy(guardianProfilesLive.userId),
    );
  }

  async findMembership(tenantId: string, membershipId: string): Promise<MembershipRecord | null> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const [row] = await tx
        .select({ userId: membershipsLive.userId, studentProfileId: studentProfilesLive.id })
        .from(membershipsLive)
        .leftJoin(studentProfilesLive, eq(studentProfilesLive.membershipId, membershipsLive.id))
        .where(and(eq(membershipsLive.id, membershipId), eq(membershipsLive.status, 'ACTIVE')))
        .limit(1);
      return row ? { userId: row.userId, isStudent: row.studentProfileId !== null } : null;
    });
  }

  async findInstituteTimezone(tenantId: string): Promise<string | null> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const [row] = await tx
        .select({ timezone: institutesLive.timezone })
        .from(institutesLive)
        .where(eq(institutesLive.id, tenantId))
        .limit(1);
      return row?.timezone ?? null;
    });
  }
}
