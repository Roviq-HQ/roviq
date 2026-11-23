import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  guardianProfilesLive,
  institutesLive,
  membershipsLive,
  mkInstituteCtx,
  staffProfilesLive,
  studentGuardianLinksLive,
  studentProfilesLive,
  withTenant,
} from '@roviq/database';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { RecipientReadRepository } from './recipient-read.repository';
import type { GuardianRecord, MembershipRecord } from './types';

const ORIGIN = 'repository:notification-recipients';

@Injectable()
export class RecipientReadDrizzleRepository extends RecipientReadRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async findStudentGuardians(
    tenantId: string,
    studentMembershipId: string,
  ): Promise<GuardianRecord[]> {
    const staffMemberships = alias(membershipsLive, 'staff_memberships');
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), (tx) => {
      // Staff of this institute: RLS limits both tables to the institute the read runs as.
      const isStaff = sql<boolean>`EXISTS (${tx
        .select({ one: sql`1` })
        .from(staffProfilesLive)
        .innerJoin(staffMemberships, eq(staffMemberships.id, staffProfilesLive.membershipId))
        .where(
          and(
            eq(staffProfilesLive.userId, guardianProfilesLive.userId),
            eq(staffMemberships.status, 'ACTIVE'),
          ),
        )})`;
      return tx
        .select({
          userId: guardianProfilesLive.userId,
          membershipId: guardianProfilesLive.membershipId,
          isStaff,
          isPrimaryContact: studentGuardianLinksLive.isPrimaryContact,
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
        .orderBy(
          desc(isStaff),
          desc(studentGuardianLinksLive.isPrimaryContact),
          asc(studentGuardianLinksLive.createdAt),
          asc(studentGuardianLinksLive.id),
        );
    });
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

  async findInstituteName(tenantId: string): Promise<Record<string, string> | null> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const [row] = await tx
        .select({ name: institutesLive.name })
        .from(institutesLive)
        .where(eq(institutesLive.id, tenantId))
        .limit(1);
      return row?.name ?? null;
    });
  }
}
