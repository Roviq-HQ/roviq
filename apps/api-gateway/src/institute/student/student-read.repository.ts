import { Inject, Injectable } from '@nestjs/common';
import type { InstituteReadAccess } from '@roviq/casl';
import type { InstituteContext } from '@roviq/common-types';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import {
  academicYearsLive,
  DRIZZLE_DB,
  type DrizzleDB,
  guardianProfilesLive,
  sectionsLive,
  standardsLive,
  studentAcademicsLive,
  studentGuardianLinksLive,
  studentProfilesLive,
  tenantUserProfilesLive,
  userDocumentsLive,
  withTenant,
} from '@roviq/database';
import { and, asc, count, desc, eq, ilike, inArray, or, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { decodeCursor, encodeCursor } from '../../common/pagination/relay-pagination.model';
import { loadUserDocumentFiles } from '../../files/user-document-files';
import type { StudentFilterInput } from './dto/student-filter.input';
import type { StudentStatisticsModel } from './models/student-statistics.model';
import { activeAcademicYearIds, studentReadPredicate } from './student-read-predicate';

/** The institute's own copy of the student's name, demographics and picture. */
function studentProfileJoin() {
  return and(
    eq(tenantUserProfilesLive.userId, studentProfilesLive.userId),
    eq(tenantUserProfilesLive.tenantId, studentProfilesLive.tenantId),
  );
}

@Injectable()
export class StudentReadRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}
  async isVisible(id: string, access: InstituteReadAccess) {
    const rows = await withTenant(this.db, access.user, (tx) =>
      tx
        .select({ id: studentProfilesLive.id })
        .from(studentProfilesLive)
        .where(and(eq(studentProfilesLive.id, id), studentReadPredicate(access.ability, null)))
        .limit(1),
    );
    return rows.length > 0;
  }
  findById(id: string, access: InstituteReadAccess) {
    return this.loadById(id, access.user, studentReadPredicate(access.ability, null));
  }
  findForMutation(id: string, ctx: InstituteContext) {
    return this.loadById(id, ctx, undefined);
  }
  list(filter: StudentFilterInput, access: InstituteReadAccess) {
    return this.loadList(
      filter,
      access.user,
      studentReadPredicate(access.ability, filter.academicYearId ?? null),
    );
  }
  listForAttendance(filter: StudentFilterInput, ctx: InstituteContext) {
    return this.loadList(filter, ctx, undefined);
  }
  private async loadById(id: string, ctx: InstituteContext, restriction: SQL | undefined) {
    const rows = await withTenant(this.db, ctx, async (tx) => {
      return tx
        .select({
          id: studentProfilesLive.id,
          tenantId: studentProfilesLive.tenantId,
          userId: studentProfilesLive.userId,
          membershipId: studentProfilesLive.membershipId,
          admissionNumber: studentProfilesLive.admissionNumber,
          admissionDate: studentProfilesLive.admissionDate,
          admissionClass: studentProfilesLive.admissionClass,
          admissionType: studentProfilesLive.admissionType,
          academicStatus: studentProfilesLive.academicStatus,
          socialCategory: studentProfilesLive.socialCategory,
          caste: studentProfilesLive.caste,
          isMinority: studentProfilesLive.isMinority,
          minorityType: studentProfilesLive.minorityType,
          isBpl: studentProfilesLive.isBpl,
          isCwsn: studentProfilesLive.isCwsn,
          cwsnType: studentProfilesLive.cwsnType,
          isRteAdmitted: studentProfilesLive.isRteAdmitted,
          rteCertificate: studentProfilesLive.rteCertificate,
          tcIssued: studentProfilesLive.tcIssued,
          tcNumber: studentProfilesLive.tcNumber,
          tcIssuedDate: studentProfilesLive.tcIssuedDate,
          tcReason: studentProfilesLive.tcReason,
          dateOfLeaving: studentProfilesLive.dateOfLeaving,
          previousSchoolName: studentProfilesLive.previousSchoolName,
          previousSchoolBoard: studentProfilesLive.previousSchoolBoard,
          medicalInfo: studentProfilesLive.medicalInfo,
          version: studentProfilesLive.version,
          createdAt: studentProfilesLive.createdAt,
          updatedAt: studentProfilesLive.updatedAt,
          // the institute's copy of the student's name and demographics
          firstName: tenantUserProfilesLive.firstName,
          lastName: tenantUserProfilesLive.lastName,
          gender: tenantUserProfilesLive.gender,
          dateOfBirth: tenantUserProfilesLive.dateOfBirth,
          bloodGroup: tenantUserProfilesLive.bloodGroup,
          religion: tenantUserProfilesLive.religion,
          motherTongue: tenantUserProfilesLive.motherTongue,
          profileImageFileId: tenantUserProfilesLive.profileImageFileId,
          // current academic
          currentStudentAcademicId: studentAcademicsLive.id,
          currentStandardId: studentAcademicsLive.standardId,
          currentSectionId: studentAcademicsLive.sectionId,
          currentAcademicYearId: studentAcademicsLive.academicYearId,
          rollNumber: studentAcademicsLive.rollNumber,
          currentStandardName: standardsLive.name,
          currentSectionName: sectionsLive.name,
          promotionStatus: studentAcademicsLive.promotionStatus,
        })
        .from(studentProfilesLive)
        .innerJoin(tenantUserProfilesLive, studentProfileJoin())
        .leftJoin(
          studentAcademicsLive,
          and(
            eq(studentAcademicsLive.studentProfileId, studentProfilesLive.id),
            inArray(studentAcademicsLive.academicYearId, activeAcademicYearIds()),
          ),
        )
        .leftJoin(standardsLive, eq(standardsLive.id, studentAcademicsLive.standardId))
        .leftJoin(sectionsLive, eq(sectionsLive.id, studentAcademicsLive.sectionId))
        .where(and(eq(studentProfilesLive.id, id), restriction))
        .limit(1);
    });

    if (rows.length === 0) {
      throw new BusinessException(ErrorCode.STUDENT_NOT_FOUND, 'Student not found');
    }

    return rows[0];
  }

  private async loadList(
    filter: StudentFilterInput,
    ctx: InstituteContext,
    restriction: SQL | undefined,
  ) {
    const limit = filter.first ?? 25;

    // Resolve academic year (default to active)
    let academicYearId = filter.academicYearId;
    if (!academicYearId) {
      const activeYear = await withTenant(this.db, ctx, async (tx) => {
        return tx
          .select({ id: academicYearsLive.id })
          .from(academicYearsLive)
          .where(eq(academicYearsLive.isActive, true))
          .limit(1);
      });
      if (activeYear.length > 0) {
        academicYearId = activeYear[0].id;
      }
    }

    const conditions = this.buildListConditions(filter, academicYearId);
    if (restriction) conditions.push(restriction);

    // Cursor decode
    let cursorCondition: ReturnType<typeof sql> | undefined;
    if (filter.after) {
      const decoded = decodeCursor(filter.after);
      cursorCondition = sql`${studentProfilesLive.id} > ${decoded.id}`;
    }

    const where = and(
      ...(conditions.length > 0 ? conditions : []),
      ...(cursorCondition ? [cursorCondition] : []),
    );

    // Whitelisted sort columns — prevents injection via orderBy string.
    const ORDER_COLUMNS = {
      createdAt: studentProfilesLive.createdAt,
      admissionNumber: studentProfilesLive.admissionNumber,
      admissionDate: studentProfilesLive.admissionDate,
      academicStatus: studentProfilesLive.academicStatus,
    } as const;
    type OrderKey = keyof typeof ORDER_COLUMNS;
    let orderColumn: (typeof ORDER_COLUMNS)[OrderKey] = studentProfilesLive.createdAt;
    let orderDir: 'asc' | 'desc' = 'desc';
    if (filter.orderBy) {
      const [field, dir] = filter.orderBy.split(':');
      if (field && field in ORDER_COLUMNS) {
        orderColumn = ORDER_COLUMNS[field as OrderKey];
      }
      if (dir === 'asc' || dir === 'desc') {
        orderDir = dir;
      }
    }
    const orderExpr = orderDir === 'asc' ? asc(orderColumn) : desc(orderColumn);

    // The primary guardian's name is a second join on the institute's profile copies.
    const guardianTenantProfiles = alias(tenantUserProfilesLive, 'guardian_tenant_user_profiles');

    return withTenant(this.db, ctx, async (tx) => {
      // Count total (without cursor)
      const countWhere = conditions.length > 0 ? and(...conditions) : undefined;
      const [{ total }] = await tx
        .select({ total: count() })
        .from(studentProfilesLive)
        .innerJoin(tenantUserProfilesLive, studentProfileJoin())
        .leftJoin(
          studentAcademicsLive,
          eq(studentAcademicsLive.studentProfileId, studentProfilesLive.id),
        )
        .where(countWhere);

      // Fetch rows
      const rows = await tx
        .select({
          id: studentProfilesLive.id,
          tenantId: studentProfilesLive.tenantId,
          userId: studentProfilesLive.userId,
          membershipId: studentProfilesLive.membershipId,
          admissionNumber: studentProfilesLive.admissionNumber,
          admissionDate: studentProfilesLive.admissionDate,
          admissionClass: studentProfilesLive.admissionClass,
          admissionType: studentProfilesLive.admissionType,
          academicStatus: studentProfilesLive.academicStatus,
          socialCategory: studentProfilesLive.socialCategory,
          caste: studentProfilesLive.caste,
          isMinority: studentProfilesLive.isMinority,
          minorityType: studentProfilesLive.minorityType,
          isBpl: studentProfilesLive.isBpl,
          isCwsn: studentProfilesLive.isCwsn,
          cwsnType: studentProfilesLive.cwsnType,
          isRteAdmitted: studentProfilesLive.isRteAdmitted,
          rteCertificate: studentProfilesLive.rteCertificate,
          tcIssued: studentProfilesLive.tcIssued,
          tcNumber: studentProfilesLive.tcNumber,
          tcIssuedDate: studentProfilesLive.tcIssuedDate,
          tcReason: studentProfilesLive.tcReason,
          dateOfLeaving: studentProfilesLive.dateOfLeaving,
          previousSchoolName: studentProfilesLive.previousSchoolName,
          previousSchoolBoard: studentProfilesLive.previousSchoolBoard,
          medicalInfo: studentProfilesLive.medicalInfo,
          version: studentProfilesLive.version,
          createdAt: studentProfilesLive.createdAt,
          updatedAt: studentProfilesLive.updatedAt,
          firstName: tenantUserProfilesLive.firstName,
          lastName: tenantUserProfilesLive.lastName,
          gender: tenantUserProfilesLive.gender,
          dateOfBirth: tenantUserProfilesLive.dateOfBirth,
          bloodGroup: tenantUserProfilesLive.bloodGroup,
          religion: tenantUserProfilesLive.religion,
          motherTongue: tenantUserProfilesLive.motherTongue,
          profileImageFileId: tenantUserProfilesLive.profileImageFileId,
          currentStudentAcademicId: studentAcademicsLive.id,
          currentStandardId: studentAcademicsLive.standardId,
          currentSectionId: studentAcademicsLive.sectionId,
          currentAcademicYearId: studentAcademicsLive.academicYearId,
          rollNumber: studentAcademicsLive.rollNumber,
          currentStandardName: standardsLive.name,
          currentSectionName: sectionsLive.name,
          promotionStatus: studentAcademicsLive.promotionStatus,
          primaryGuardianProfileId: guardianProfilesLive.id,
          primaryGuardianFirstName: guardianTenantProfiles.firstName,
          primaryGuardianLastName: guardianTenantProfiles.lastName,
        })
        .from(studentProfilesLive)
        .innerJoin(tenantUserProfilesLive, studentProfileJoin())
        .leftJoin(
          studentAcademicsLive,
          eq(studentAcademicsLive.studentProfileId, studentProfilesLive.id),
        )
        .leftJoin(standardsLive, eq(standardsLive.id, studentAcademicsLive.standardId))
        .leftJoin(sectionsLive, eq(sectionsLive.id, studentAcademicsLive.sectionId))
        .leftJoin(
          studentGuardianLinksLive,
          and(
            eq(studentGuardianLinksLive.studentProfileId, studentProfilesLive.id),
            eq(studentGuardianLinksLive.isPrimaryContact, true),
          ),
        )
        .leftJoin(
          guardianProfilesLive,
          eq(guardianProfilesLive.id, studentGuardianLinksLive.guardianProfileId),
        )
        .leftJoin(
          guardianTenantProfiles,
          and(
            eq(guardianTenantProfiles.userId, guardianProfilesLive.userId),
            eq(guardianTenantProfiles.tenantId, guardianProfilesLive.tenantId),
          ),
        )
        .where(where)
        .orderBy(orderExpr, asc(studentProfilesLive.id))
        .limit(limit + 1); // +1 for hasNextPage

      const hasNextPage = rows.length > limit;
      if (hasNextPage) rows.pop();

      const edges = rows.map((row) => ({
        node: row,
        cursor: encodeCursor({ id: row.id }),
      }));

      return {
        edges,
        totalCount: total,
        pageInfo: {
          hasNextPage,
          hasPreviousPage: !!filter.after,
          startCursor: edges[0]?.cursor ?? null,
          endCursor: edges[edges.length - 1]?.cursor ?? null,
        },
      };
    });
  }

  // ── UPDATE ────────────────────────────────────────────────

  async statistics(access: InstituteReadAccess): Promise<StudentStatisticsModel> {
    const restriction = studentReadPredicate(access.ability, null);

    return withTenant(this.db, access.user, async (tx) => {
      const [{ total }] = await tx
        .select({ total: count() })
        .from(studentProfilesLive)
        .where(restriction);

      const byStatus = await tx
        .select({ status: studentProfilesLive.academicStatus, count: count() })
        .from(studentProfilesLive)
        .where(restriction)
        .groupBy(studentProfilesLive.academicStatus);

      const bySection = await tx
        .select({ sectionId: studentAcademicsLive.sectionId, count: count() })
        .from(studentAcademicsLive)
        .innerJoin(academicYearsLive, eq(academicYearsLive.id, studentAcademicsLive.academicYearId))
        .innerJoin(
          studentProfilesLive,
          eq(studentProfilesLive.id, studentAcademicsLive.studentProfileId),
        )
        .where(and(eq(academicYearsLive.isActive, true), restriction))
        .groupBy(studentAcademicsLive.sectionId);

      const byStandard = await tx
        .select({ standardId: studentAcademicsLive.standardId, count: count() })
        .from(studentAcademicsLive)
        .innerJoin(academicYearsLive, eq(academicYearsLive.id, studentAcademicsLive.academicYearId))
        .innerJoin(
          studentProfilesLive,
          eq(studentProfilesLive.id, studentAcademicsLive.studentProfileId),
        )
        .where(and(eq(academicYearsLive.isActive, true), restriction))
        .groupBy(studentAcademicsLive.standardId);

      const byGender = await tx
        .select({ gender: tenantUserProfilesLive.gender, count: count() })
        .from(studentProfilesLive)
        .innerJoin(tenantUserProfilesLive, studentProfileJoin())
        .where(restriction)
        .groupBy(tenantUserProfilesLive.gender);

      const byCategory = await tx
        .select({ category: studentProfilesLive.socialCategory, count: count() })
        .from(studentProfilesLive)
        .where(restriction)
        .groupBy(studentProfilesLive.socialCategory);

      return {
        total,
        byStatus: (access.ability.can('read', 'Student', 'academicStatus') ? byStatus : []).map(
          (r) => ({ status: r.status, count: r.count }),
        ),
        bySection: (access.ability.can('read', 'Student', 'currentSectionId') ? bySection : []).map(
          (r) => ({ sectionId: r.sectionId, count: r.count }),
        ),
        byStandard: (access.ability.can('read', 'Student', 'currentStandardId')
          ? byStandard
          : []
        ).map((r) => ({ standardId: r.standardId, count: r.count })),
        byGender: (access.ability.can('read', 'Student', 'gender') ? byGender : []).map((r) => ({
          gender: r.gender ?? 'unknown',
          count: r.count,
        })),
        byCategory: (access.ability.can('read', 'Student', 'socialCategory') ? byCategory : []).map(
          (r) => ({ category: r.category, count: r.count }),
        ),
      };
    });
  }

  async listDocumentsForStudent(studentProfileId: string, access: InstituteReadAccess) {
    // 1. Verify the student belongs to this tenant and resolve their userId.
    const studentRows = await withTenant(this.db, access.user, async (tx) => {
      return tx
        .select({ userId: studentProfilesLive.userId })
        .from(studentProfilesLive)
        .where(
          and(
            eq(studentProfilesLive.id, studentProfileId),
            studentReadPredicate(access.ability, null),
          ),
        )
        .limit(1);
    });

    if (studentRows.length === 0) {
      throw new BusinessException(ErrorCode.STUDENT_NOT_FOUND, 'Student not found');
    }

    const userId = studentRows[0].userId;

    // 2. Read documents from the platform-level user_documents table.
    return withTenant(this.db, access.user, async (tx) => {
      const rows = await tx
        .select({
          id: userDocumentsLive.id,
          userId: userDocumentsLive.userId,
          type: userDocumentsLive.type,
          description: userDocumentsLive.description,
          referenceNumber: userDocumentsLive.referenceNumber,
          isVerified: userDocumentsLive.isVerified,
          verifiedAt: userDocumentsLive.verifiedAt,
          verifiedBy: userDocumentsLive.verifiedBy,
          rejectionReason: userDocumentsLive.rejectionReason,
          expiryDate: userDocumentsLive.expiryDate,
          createdAt: userDocumentsLive.createdAt,
          updatedAt: userDocumentsLive.updatedAt,
        })
        .from(userDocumentsLive)
        .where(eq(userDocumentsLive.userId, userId))
        .orderBy(sql`${userDocumentsLive.createdAt} DESC`);

      const visible = rows.filter(
        (row) => row.type !== 'AADHAAR_CARD' || access.ability.can('read', 'Student', 'aadhaar'),
      );
      const files = await loadUserDocumentFiles(
        tx,
        visible.map((row) => row.id),
      );
      return visible.map((row) => ({
        ...row,
        files: files.get(row.id) ?? [],
        verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
        expiryDate: row.expiryDate ?? null,
      }));
    });
  }

  private buildListConditions(
    filter: StudentFilterInput,
    academicYearId: string | undefined,
  ): SQL[] {
    const conditions: SQL[] = [];
    if (academicYearId) {
      conditions.push(eq(studentAcademicsLive.academicYearId, academicYearId));
    }
    if (filter.standardId) {
      conditions.push(eq(studentAcademicsLive.standardId, filter.standardId));
    }
    if (filter.sectionId) {
      conditions.push(eq(studentAcademicsLive.sectionId, filter.sectionId));
    }
    if (filter.academicStatus && filter.academicStatus.length > 0) {
      conditions.push(inArray(studentProfilesLive.academicStatus, filter.academicStatus));
    }
    if (filter.socialCategory) {
      conditions.push(eq(studentProfilesLive.socialCategory, filter.socialCategory));
    }
    if (filter.isRteAdmitted !== undefined) {
      conditions.push(eq(studentProfilesLive.isRteAdmitted, filter.isRteAdmitted));
    }
    if (filter.gender) {
      conditions.push(eq(tenantUserProfilesLive.gender, filter.gender));
    }
    if (filter.search) {
      const searchTerm = filter.search;
      const searchCondition = or(
        sql`${tenantUserProfilesLive.searchVector} @@ plainto_tsquery('simple', ${searchTerm})`,
        ilike(studentProfilesLive.admissionNumber, `%${searchTerm}%`),
      );
      if (searchCondition) conditions.push(searchCondition);
    }
    return conditions;
  }
}
