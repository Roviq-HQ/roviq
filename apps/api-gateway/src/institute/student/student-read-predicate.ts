import { caslToSqlWhere } from '@roviq/casl';
import type { AppAbility } from '@roviq/common-types';
import { academicYearsLive, studentAcademicsLive, studentProfilesLive } from '@roviq/database';
import { sql } from 'drizzle-orm';

export function studentReadPredicate(ability: AppAbility) {
  const restriction = caslToSqlWhere(ability, 'read', 'Student', {
    id: 'read_student.id',
    userId: 'read_student.user_id',
    tenantId: 'read_student.tenant_id',
    membershipId: 'read_student.membership_id',
    sectionId: 'read_academic.section_id',
    standardId: 'read_academic.standard_id',
    academicYearId: 'read_academic.academic_year_id',
  });
  if (!restriction) return undefined;
  // Keep section conditions correlated without duplicating students in counts or pages.
  return sql`EXISTS (
    SELECT 1 FROM ${studentProfilesLive} AS read_student
    LEFT JOIN ${studentAcademicsLive} AS read_academic
      ON read_academic.student_profile_id = read_student.id
      AND read_academic.academic_year_id IN (
        SELECT id FROM ${academicYearsLive} WHERE is_active = true
      )
    WHERE read_student.id = ${studentProfilesLive.id} AND ${restriction}
  )`;
}
