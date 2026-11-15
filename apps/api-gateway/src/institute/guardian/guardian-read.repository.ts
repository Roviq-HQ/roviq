import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { InstituteReadAccess } from '@roviq/casl';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  guardianProfilesLive,
  phoneNumbers,
  sectionsLive,
  standardsLive,
  studentAcademicsLive,
  studentGuardianLinks,
  studentProfilesLive,
  userProfiles,
  withTenant,
} from '@roviq/database';
import { and, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { activeAcademicYearIds, studentReadPredicate } from '../student/student-read-predicate';
import type { ListGuardiansFilterInput } from './dto/list-guardians-filter.input';
import { guardianLinkedReadPredicate, guardianReadPredicate } from './guardian-read-predicate';

@Injectable()
export class GuardianReadRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}
  private guardianSelect(access: InstituteReadAccess) {
    return {
      id: guardianProfilesLive.id,
      userId: guardianProfilesLive.userId,
      membershipId: guardianProfilesLive.membershipId,
      occupation: guardianProfilesLive.occupation,
      organization: guardianProfilesLive.organization,
      designation: guardianProfilesLive.designation,
      educationLevel: guardianProfilesLive.educationLevel,
      version: guardianProfilesLive.version,
      createdAt: guardianProfilesLive.createdAt,
      updatedAt: guardianProfilesLive.updatedAt,

      firstName: userProfiles.firstName,
      lastName: userProfiles.lastName,
      profileImageUrl: userProfiles.profileImageUrl,
      gender: userProfiles.gender,

      primaryPhone: phoneNumbers.number,

      linkedStudentCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${studentGuardianLinks}
        INNER JOIN ${studentProfilesLive} ON ${studentProfilesLive.id} = ${studentGuardianLinks.studentProfileId}
        LEFT JOIN ${studentAcademicsLive} ON ${studentAcademicsLive.studentProfileId} = ${studentProfilesLive.id}
          AND ${inArray(studentAcademicsLive.academicYearId, activeAcademicYearIds())}
        WHERE ${studentGuardianLinks.guardianProfileId} = ${guardianProfilesLive.id}
          AND ${guardianLinkedReadPredicate(access.ability) ?? sql`true`}
          AND ${studentReadPredicate(access.ability) ?? sql`true`}
      )`.as('linked_student_count'),
    } as const;
  }

  async findById(id: string, access: InstituteReadAccess) {
    const rows = await withTenant(this.db, access.user, async (tx) => {
      return tx
        .select(this.guardianSelect(access))
        .from(guardianProfilesLive)
        .innerJoin(userProfiles, eq(userProfiles.userId, guardianProfilesLive.userId))
        .leftJoin(
          phoneNumbers,
          and(
            eq(phoneNumbers.userId, guardianProfilesLive.userId),
            eq(phoneNumbers.isPrimary, true),
          ),
        )
        .where(and(eq(guardianProfilesLive.id, id), guardianReadPredicate(access.ability)))
        .limit(1);
    });
    if (rows.length === 0) throw new NotFoundException(`Guardian profile ${id} not found`);
    return rows[0];
  }

  async list(filter: ListGuardiansFilterInput, access: InstituteReadAccess) {
    const search = filter?.search?.trim();

    return withTenant(this.db, access.user, async (tx) => {
      const baseQuery = tx
        .select(this.guardianSelect(access))
        .from(guardianProfilesLive)
        .innerJoin(userProfiles, eq(userProfiles.userId, guardianProfilesLive.userId))
        .leftJoin(
          phoneNumbers,
          and(
            eq(phoneNumbers.userId, guardianProfilesLive.userId),
            eq(phoneNumbers.isPrimary, true),
          ),
        );

      const searchClause = search
        ? or(
            sql`${userProfiles.searchVector} @@ plainto_tsquery('simple', ${search})`,
            ilike(phoneNumbers.number, `%${search}%`),
          )
        : undefined;

      return baseQuery.where(and(searchClause, guardianReadPredicate(access.ability))).limit(200);
    });
  }

  async listLinkedStudents(guardianProfileId: string, access: InstituteReadAccess) {
    return withTenant(this.db, access.user, async (tx) => {
      return tx
        .select({
          linkId: studentGuardianLinks.id,
          studentProfileId: studentGuardianLinks.studentProfileId,
          userId: studentProfilesLive.userId,
          tenantId: studentProfilesLive.tenantId,
          currentAcademicYearId: studentAcademicsLive.academicYearId,
          membershipId: studentProfilesLive.membershipId,
          currentSectionId: studentAcademicsLive.sectionId,
          currentStandardId: studentAcademicsLive.standardId,
          admissionNumber: studentProfilesLive.admissionNumber,
          firstName: userProfiles.firstName,
          lastName: userProfiles.lastName,
          profileImageUrl: userProfiles.profileImageUrl,
          currentStandardName: standardsLive.name,
          currentSectionName: sectionsLive.name,
          relationship: studentGuardianLinks.relationship,
          isPrimaryContact: studentGuardianLinks.isPrimaryContact,
          isEmergencyContact: studentGuardianLinks.isEmergencyContact,
          canPickup: studentGuardianLinks.canPickup,
          livesWith: studentGuardianLinks.livesWith,
        })
        .from(studentGuardianLinks)
        .innerJoin(
          studentProfilesLive,
          eq(studentProfilesLive.id, studentGuardianLinks.studentProfileId),
        )
        .innerJoin(
          guardianProfilesLive,
          eq(guardianProfilesLive.id, studentGuardianLinks.guardianProfileId),
        )
        .innerJoin(userProfiles, eq(userProfiles.userId, studentProfilesLive.userId))
        .leftJoin(
          studentAcademicsLive,
          and(
            eq(studentAcademicsLive.studentProfileId, studentProfilesLive.id),
            inArray(studentAcademicsLive.academicYearId, activeAcademicYearIds()),
          ),
        )
        .leftJoin(standardsLive, eq(standardsLive.id, studentAcademicsLive.standardId))
        .leftJoin(sectionsLive, eq(sectionsLive.id, studentAcademicsLive.sectionId))
        .where(
          and(
            eq(studentGuardianLinks.guardianProfileId, guardianProfileId),
            guardianLinkedReadPredicate(access.ability),
            studentReadPredicate(access.ability),
          ),
        )
        .orderBy(sql`${studentGuardianLinks.isPrimaryContact} DESC`);
    });
  }

  async listForStudent(studentProfileId: string, access: InstituteReadAccess) {
    return withTenant(this.db, access.user, async (tx) => {
      return tx
        .select({
          linkId: studentGuardianLinks.id,
          guardianProfileId: studentGuardianLinks.guardianProfileId,
          userId: guardianProfilesLive.userId,
          firstName: userProfiles.firstName,
          lastName: userProfiles.lastName,
          profileImageUrl: userProfiles.profileImageUrl,
          occupation: guardianProfilesLive.occupation,
          organization: guardianProfilesLive.organization,
          relationship: studentGuardianLinks.relationship,
          isPrimaryContact: studentGuardianLinks.isPrimaryContact,
          isEmergencyContact: studentGuardianLinks.isEmergencyContact,
          canPickup: studentGuardianLinks.canPickup,
          livesWith: studentGuardianLinks.livesWith,
        })
        .from(studentGuardianLinks)
        .innerJoin(
          guardianProfilesLive,
          eq(guardianProfilesLive.id, studentGuardianLinks.guardianProfileId),
        )
        .innerJoin(userProfiles, eq(userProfiles.userId, guardianProfilesLive.userId))
        .innerJoin(
          studentProfilesLive,
          eq(studentProfilesLive.id, studentGuardianLinks.studentProfileId),
        )
        .leftJoin(
          studentAcademicsLive,
          and(
            eq(studentAcademicsLive.studentProfileId, studentProfilesLive.id),
            inArray(studentAcademicsLive.academicYearId, activeAcademicYearIds()),
          ),
        )
        .where(
          and(
            eq(studentGuardianLinks.studentProfileId, studentProfileId),
            guardianLinkedReadPredicate(access.ability),
            studentReadPredicate(access.ability),
          ),
        )
        .orderBy(sql`${studentGuardianLinks.isPrimaryContact} DESC`);
    });
  }
}
