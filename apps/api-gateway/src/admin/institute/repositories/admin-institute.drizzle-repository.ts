import { Inject, Injectable } from '@nestjs/common';
import {
  academicYearsLive,
  DRIZZLE_DB,
  type DrizzleDB,
  instituteAffiliationsLive,
  instituteGroupsLive,
  mkAdminCtx,
  resellersLive,
  sectionsLive,
  standardSubjectsLive,
  standardsLive,
  subjectsLive,
  withAdmin,
} from '@roviq/database';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { AdminInstituteRepository } from './admin-institute.repository';
import type { AcademicTreeRows, AdminResellerStatusRow } from './types';

@Injectable()
export class AdminInstituteDrizzleRepository extends AdminInstituteRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async findReseller(resellerId: string): Promise<AdminResellerStatusRow | null> {
    const rows = await withAdmin(this.db, mkAdminCtx('service:admin-institute'), async (tx) =>
      tx
        .select({
          id: resellersLive.id,
          status: resellersLive.status,
          isActive: resellersLive.isActive,
        })
        .from(resellersLive)
        .where(eq(resellersLive.id, resellerId))
        .limit(1),
    );
    return rows[0] ?? null;
  }

  async instituteGroupExists(groupId: string): Promise<boolean> {
    const rows = await withAdmin(this.db, mkAdminCtx('service:admin-institute'), async (tx) =>
      tx
        .select({ id: instituteGroupsLive.id })
        .from(instituteGroupsLive)
        .where(eq(instituteGroupsLive.id, groupId))
        .limit(1),
    );
    return rows.length > 0;
  }

  async findAcademicTreeRows(instituteId: string): Promise<AcademicTreeRows> {
    return withAdmin(this.db, mkAdminCtx('service:admin-institute'), async (tx) => {
      const yearRows = await tx
        .select({ id: academicYearsLive.id })
        .from(academicYearsLive)
        .where(eq(academicYearsLive.tenantId, instituteId))
        .orderBy(desc(academicYearsLive.startDate))
        .limit(1);
      const academicYearId = yearRows[0]?.id;

      if (!academicYearId) return { academicYearId: null };

      const [standards, sections, standardSubjects, subjects] = await Promise.all([
        tx
          .select({
            id: standardsLive.id,
            name: standardsLive.name,
            numericOrder: standardsLive.numericOrder,
            department: standardsLive.department,
          })
          .from(standardsLive)
          .where(
            and(
              eq(standardsLive.tenantId, instituteId),
              eq(standardsLive.academicYearId, academicYearId),
            ),
          )
          .orderBy(asc(standardsLive.numericOrder)),
        tx
          .select({
            id: sectionsLive.id,
            name: sectionsLive.name,
            stream: sectionsLive.stream,
            standardId: sectionsLive.standardId,
          })
          .from(sectionsLive)
          .where(
            and(
              eq(sectionsLive.tenantId, instituteId),
              eq(sectionsLive.academicYearId, academicYearId),
            ),
          )
          .orderBy(asc(sectionsLive.displayOrder), asc(sectionsLive.name)),
        tx
          .select({
            subjectId: standardSubjectsLive.subjectId,
            standardId: standardSubjectsLive.standardId,
          })
          .from(standardSubjectsLive)
          .where(eq(standardSubjectsLive.tenantId, instituteId)),
        tx
          .select({
            id: subjectsLive.id,
            name: subjectsLive.name,
            shortName: subjectsLive.shortName,
            boardCode: subjectsLive.boardCode,
            type: subjectsLive.type,
          })
          .from(subjectsLive)
          .where(eq(subjectsLive.tenantId, instituteId)),
      ]);

      return { academicYearId, standards, sections, standardSubjects, subjects };
    });
  }

  async findPrimaryBoard(instituteId: string): Promise<string | undefined> {
    return withAdmin(this.db, mkAdminCtx('service:admin-institute'), async (tx) => {
      const rows = await tx
        .select({ board: instituteAffiliationsLive.board })
        .from(instituteAffiliationsLive)
        .where(eq(instituteAffiliationsLive.tenantId, instituteId))
        // Undated rows (recorded at request time) rank after dated ones; oldest row breaks ties.
        .orderBy(
          sql`${instituteAffiliationsLive.validFrom} ASC NULLS LAST`,
          asc(instituteAffiliationsLive.createdAt),
        )
        .limit(1);
      return rows[0]?.board ?? undefined;
    });
  }
}
