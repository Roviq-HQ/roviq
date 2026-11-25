import { Inject, Injectable } from '@nestjs/common';
import { DefaultRoles } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  guardianProfilesLive,
  institutesLive,
  membershipsLive,
  mkInstituteCtx,
  rolesLive,
  sectionsLive,
  staffProfilesLive,
  standardsLive,
  studentGuardianLinksLive,
  studentProfilesLive,
  withTenant,
} from '@roviq/database';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { RecipientReadRepository } from './recipient-read.repository';
import type { GuardianRecord, MembershipRecord, Recipient, SectionCapacityAudience } from './types';

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

  async isActiveGuardianOf(
    tenantId: string,
    studentMembershipId: string,
    guardianUserId: string,
  ): Promise<boolean> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const [row] = await tx
        .select({ one: sql<number>`1` })
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
            eq(guardianProfilesLive.userId, guardianUserId),
            eq(membershipsLive.status, 'ACTIVE'),
          ),
        )
        .limit(1);
      return row !== undefined;
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

  async findSectionCapacityAudience(
    tenantId: string,
    sectionId: string,
  ): Promise<SectionCapacityAudience | null> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const [section] = await tx
        .select({
          sectionName: sectionsLive.name,
          classTeacherId: sectionsLive.classTeacherId,
          standardId: standardsLive.id,
          standardName: standardsLive.name,
        })
        .from(sectionsLive)
        .innerJoin(standardsLive, eq(standardsLive.id, sectionsLive.standardId))
        .where(eq(sectionsLive.id, sectionId))
        .limit(1);
      if (!section) return null;
      const names = {
        sectionName: section.sectionName,
        standardId: section.standardId,
        standardName: section.standardName,
      };

      if (section.classTeacherId) {
        const [teacher] = await tx
          .select({ userId: membershipsLive.userId, membershipId: membershipsLive.id })
          .from(membershipsLive)
          .where(
            and(
              eq(membershipsLive.id, section.classTeacherId),
              eq(membershipsLive.status, 'ACTIVE'),
            ),
          )
          .limit(1);
        if (teacher) return { ...names, recipients: [teacher], via: 'CLASS_TEACHER' as const };
      }

      const coordinators: Recipient[] = await tx
        .select({ userId: membershipsLive.userId, membershipId: membershipsLive.id })
        .from(membershipsLive)
        .innerJoin(rolesLive, eq(rolesLive.id, membershipsLive.roleId))
        .where(
          and(
            eq(membershipsLive.status, 'ACTIVE'),
            sql`${rolesLive.name}->>'en' = ${DefaultRoles.AcademicCoordinator}`,
          ),
        )
        .orderBy(asc(membershipsLive.createdAt), asc(membershipsLive.id));
      return { ...names, recipients: coordinators, via: 'ACADEMIC_COORDINATORS' as const };
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
