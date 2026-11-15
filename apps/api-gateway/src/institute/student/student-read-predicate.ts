import { caslToSqlWhere } from '@roviq/casl';
import type { AppAbility } from '@roviq/common-types';
import { academicYearsLive, studentAcademicsLive, studentProfilesLive } from '@roviq/database';
import { and, eq, exists, inArray, sql } from 'drizzle-orm';
import { alias, QueryBuilder } from 'drizzle-orm/pg-core';

const qb = new QueryBuilder();
const readStudent = alias(studentProfilesLive, 'read_student');
const readAcademic = alias(studentAcademicsLive, 'read_academic');

/** Ids of the tenant's active academic year (tenant comes from RLS). */
export function activeAcademicYearIds() {
  return qb
    .select({ id: academicYearsLive.id })
    .from(academicYearsLive)
    .where(eq(academicYearsLive.isActive, true));
}

export function studentReadPredicate(ability: AppAbility) {
  const restriction = caslToSqlWhere(ability, 'read', 'Student', {
    id: readStudent.id,
    userId: readStudent.userId,
    tenantId: readStudent.tenantId,
    membershipId: readStudent.membershipId,
    sectionId: readAcademic.sectionId,
    standardId: readAcademic.standardId,
    academicYearId: readAcademic.academicYearId,
  });
  if (!restriction) return undefined;
  // Keep section conditions correlated without duplicating students in counts or pages.
  return exists(
    qb
      .select({ one: sql`1` })
      .from(readStudent)
      .leftJoin(
        readAcademic,
        and(
          eq(readAcademic.studentProfileId, readStudent.id),
          inArray(readAcademic.academicYearId, activeAcademicYearIds()),
        ),
      )
      .where(and(eq(readStudent.id, studentProfilesLive.id), restriction)),
  );
}
