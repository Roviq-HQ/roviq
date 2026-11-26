import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  guardianProfilesLive,
  membershipsLive,
  mkAdminCtx,
  sectionsLive,
  studentGuardianLinksLive,
  studentProfilesLive,
  timetableEntriesLive,
  timetablesLive,
  withAdmin,
} from '@roviq/database';
import { and, eq } from 'drizzle-orm';
import { MembershipAbilityRepository } from './membership-ability.repository';
import type { AbilitiesRecord } from './types';

@Injectable()
export class MembershipAbilityDrizzleRepository extends MembershipAbilityRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async findAbilities(membershipId: string, tenantId: string): Promise<AbilitiesRecord | null> {
    return withAdmin(this.db, mkAdminCtx('repository:membership-ability'), async (tx) => {
      const result = await tx
        .select({ abilities: membershipsLive.abilities })
        .from(membershipsLive)
        .where(
          and(
            eq(membershipsLive.id, membershipId),
            eq(membershipsLive.tenantId, tenantId),
            eq(membershipsLive.status, 'ACTIVE'),
          ),
        )
        .limit(1);

      return result[0] ?? null;
    });
  }

  async findReadAssignments(membershipId: string, tenantId: string) {
    return withAdmin(this.db, mkAdminCtx('repository:membership-ability'), async (tx) => {
      const sections = await tx
        .select({ id: sectionsLive.id })
        .from(sectionsLive)
        .where(
          and(eq(sectionsLive.classTeacherId, membershipId), eq(sectionsLive.tenantId, tenantId)),
        );
      const teaching = await tx
        .select({ id: timetableEntriesLive.sectionId })
        .from(timetableEntriesLive)
        .innerJoin(timetablesLive, eq(timetablesLive.id, timetableEntriesLive.timetableId))
        .where(
          and(
            eq(timetableEntriesLive.teacherId, membershipId),
            eq(timetableEntriesLive.tenantId, tenantId),
            eq(timetablesLive.status, 'ACTIVE'),
          ),
        );
      const children = await tx
        .select({ id: studentGuardianLinksLive.studentProfileId })
        .from(studentGuardianLinksLive)
        .innerJoin(
          guardianProfilesLive,
          eq(guardianProfilesLive.id, studentGuardianLinksLive.guardianProfileId),
        )
        .innerJoin(
          studentProfilesLive,
          eq(studentProfilesLive.id, studentGuardianLinksLive.studentProfileId),
        )
        .where(
          and(
            eq(guardianProfilesLive.membershipId, membershipId),
            eq(studentGuardianLinksLive.tenantId, tenantId),
            eq(guardianProfilesLive.tenantId, tenantId),
            eq(studentProfilesLive.tenantId, tenantId),
          ),
        );
      return {
        assignedSections: [...new Set([...sections, ...teaching].map((row) => row.id))],
        linkedStudentIds: children.map((row) => row.id),
      };
    });
  }
}
