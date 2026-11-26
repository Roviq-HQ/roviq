import { Inject, Injectable } from '@nestjs/common';
import type { InstituteReadAccess } from '@roviq/casl';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  guardianProfilesLive,
  phoneNumbersLive,
  sectionsLive,
  standardsLive,
  studentAcademicsLive,
  studentGuardianLinksLive,
  studentProfilesLive,
  tenantUserProfilesLive,
  withTenant,
} from '@roviq/database';
import { and, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { nameStartsWith } from '../../common/name-search';
import { withSignInStates } from '../sign-in-details/sign-in-status';
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

      firstName: tenantUserProfilesLive.firstName,
      lastName: tenantUserProfilesLive.lastName,
      profileImageFileId: tenantUserProfilesLive.profileImageFileId,
      gender: tenantUserProfilesLive.gender,

      primaryPhone: phoneNumbersLive.number,

      linkedStudentCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${studentGuardianLinksLive}
        INNER JOIN ${studentProfilesLive} ON ${studentProfilesLive.id} = ${studentGuardianLinksLive.studentProfileId}
        LEFT JOIN ${studentAcademicsLive} ON ${studentAcademicsLive.studentProfileId} = ${studentProfilesLive.id}
          AND ${inArray(studentAcademicsLive.academicYearId, activeAcademicYearIds())}
        WHERE ${studentGuardianLinksLive.guardianProfileId} = ${guardianProfilesLive.id}
          AND ${guardianLinkedReadPredicate(access.ability) ?? sql`true`}
          AND ${studentReadPredicate(access.ability, null) ?? sql`true`}
      )`.as('linked_student_count'),
    } as const;
  }

  async findById(id: string, access: InstituteReadAccess) {
    const rows = await withTenant(this.db, access.user, async (tx) => {
      const found = await tx
        .select(this.guardianSelect(access))
        .from(guardianProfilesLive)
        .innerJoin(
          tenantUserProfilesLive,
          and(
            eq(tenantUserProfilesLive.userId, guardianProfilesLive.userId),
            eq(tenantUserProfilesLive.tenantId, guardianProfilesLive.tenantId),
          ),
        )
        .leftJoin(
          phoneNumbersLive,
          and(
            eq(phoneNumbersLive.userId, guardianProfilesLive.userId),
            eq(phoneNumbersLive.isPrimary, true),
          ),
        )
        .where(and(eq(guardianProfilesLive.id, id), guardianReadPredicate(access.ability)))
        .limit(1);
      return withSignInStates(tx, access.user.tenantId, found);
    });
    if (rows.length === 0)
      throw new BusinessException(ErrorCode.GUARDIAN_NOT_FOUND, `Guardian profile ${id} not found`);
    return rows[0];
  }

  async list(filter: ListGuardiansFilterInput, access: InstituteReadAccess) {
    const search = filter?.search?.trim();

    return withTenant(this.db, access.user, async (tx) => {
      const baseQuery = tx
        .select(this.guardianSelect(access))
        .from(guardianProfilesLive)
        .innerJoin(
          tenantUserProfilesLive,
          and(
            eq(tenantUserProfilesLive.userId, guardianProfilesLive.userId),
            eq(tenantUserProfilesLive.tenantId, guardianProfilesLive.tenantId),
          ),
        )
        .leftJoin(
          phoneNumbersLive,
          and(
            eq(phoneNumbersLive.userId, guardianProfilesLive.userId),
            eq(phoneNumbersLive.isPrimary, true),
          ),
        );

      const searchClause = search
        ? or(
            nameStartsWith(tenantUserProfilesLive.searchVector, search),
            ilike(phoneNumbersLive.number, `%${search}%`),
          )
        : undefined;

      const rows = await baseQuery
        .where(and(searchClause, guardianReadPredicate(access.ability)))
        .limit(200);
      return withSignInStates(tx, access.user.tenantId, rows);
    });
  }

  async listLinkedStudents(guardianProfileId: string, access: InstituteReadAccess) {
    return withTenant(this.db, access.user, async (tx) => {
      return tx
        .select({
          linkId: studentGuardianLinksLive.id,
          studentProfileId: studentGuardianLinksLive.studentProfileId,
          userId: studentProfilesLive.userId,
          tenantId: studentProfilesLive.tenantId,
          currentAcademicYearId: studentAcademicsLive.academicYearId,
          membershipId: studentProfilesLive.membershipId,
          currentSectionId: studentAcademicsLive.sectionId,
          currentStandardId: studentAcademicsLive.standardId,
          admissionNumber: studentProfilesLive.admissionNumber,
          firstName: tenantUserProfilesLive.firstName,
          lastName: tenantUserProfilesLive.lastName,
          profileImageFileId: tenantUserProfilesLive.profileImageFileId,
          currentStandardName: standardsLive.name,
          currentSectionName: sectionsLive.name,
          relationship: studentGuardianLinksLive.relationship,
          isPrimaryContact: studentGuardianLinksLive.isPrimaryContact,
          isEmergencyContact: studentGuardianLinksLive.isEmergencyContact,
          canPickup: studentGuardianLinksLive.canPickup,
          livesWith: studentGuardianLinksLive.livesWith,
          accessRevokedAt: studentGuardianLinksLive.accessRevokedAt,
        })
        .from(studentGuardianLinksLive)
        .innerJoin(
          studentProfilesLive,
          eq(studentProfilesLive.id, studentGuardianLinksLive.studentProfileId),
        )
        .innerJoin(
          guardianProfilesLive,
          eq(guardianProfilesLive.id, studentGuardianLinksLive.guardianProfileId),
        )
        .innerJoin(
          tenantUserProfilesLive,
          and(
            eq(tenantUserProfilesLive.userId, studentProfilesLive.userId),
            eq(tenantUserProfilesLive.tenantId, studentProfilesLive.tenantId),
          ),
        )
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
            eq(studentGuardianLinksLive.guardianProfileId, guardianProfileId),
            guardianLinkedReadPredicate(access.ability),
            studentReadPredicate(access.ability, null),
          ),
        )
        .orderBy(sql`${studentGuardianLinksLive.isPrimaryContact} DESC`);
    });
  }

  async listForStudent(studentProfileId: string, access: InstituteReadAccess) {
    return withTenant(this.db, access.user, async (tx) => {
      return tx
        .select({
          linkId: studentGuardianLinksLive.id,
          guardianProfileId: studentGuardianLinksLive.guardianProfileId,
          userId: guardianProfilesLive.userId,
          firstName: tenantUserProfilesLive.firstName,
          lastName: tenantUserProfilesLive.lastName,
          profileImageFileId: tenantUserProfilesLive.profileImageFileId,
          occupation: guardianProfilesLive.occupation,
          organization: guardianProfilesLive.organization,
          relationship: studentGuardianLinksLive.relationship,
          isPrimaryContact: studentGuardianLinksLive.isPrimaryContact,
          isEmergencyContact: studentGuardianLinksLive.isEmergencyContact,
          canPickup: studentGuardianLinksLive.canPickup,
          livesWith: studentGuardianLinksLive.livesWith,
          accessRevokedAt: studentGuardianLinksLive.accessRevokedAt,
        })
        .from(studentGuardianLinksLive)
        .innerJoin(
          guardianProfilesLive,
          eq(guardianProfilesLive.id, studentGuardianLinksLive.guardianProfileId),
        )
        .innerJoin(
          tenantUserProfilesLive,
          and(
            eq(tenantUserProfilesLive.userId, guardianProfilesLive.userId),
            eq(tenantUserProfilesLive.tenantId, guardianProfilesLive.tenantId),
          ),
        )
        .innerJoin(
          studentProfilesLive,
          eq(studentProfilesLive.id, studentGuardianLinksLive.studentProfileId),
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
            eq(studentGuardianLinksLive.studentProfileId, studentProfileId),
            guardianLinkedReadPredicate(access.ability),
            studentReadPredicate(access.ability, null),
          ),
        )
        .orderBy(sql`${studentGuardianLinksLive.isPrimaryContact} DESC`);
    });
  }
}
