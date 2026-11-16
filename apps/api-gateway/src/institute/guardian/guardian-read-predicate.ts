import { caslToSqlWhere } from '@roviq/casl';
import type { AppAbility } from '@roviq/common-types';
import {
  academicYearsLive,
  guardianProfilesLive,
  studentAcademicsLive,
  studentGuardianLinks,
  studentProfilesLive,
} from '@roviq/database';
import { sql } from 'drizzle-orm';

export function guardianLinkedReadPredicate(ability: AppAbility, correlated = false) {
  const guardian = correlated ? 'guardian_scope_profile' : 'guardian_profiles_live';
  const academic = correlated ? 'guardian_scope_academic' : 'student_academics_live';
  return caslToSqlWhere(ability, 'read', 'Guardian', {
    id: `${guardian}.id`,
    userId: `${guardian}.user_id`,
    membershipId: `${guardian}.membership_id`,
    tenantId: `${guardian}.tenant_id`,
    sectionId: `${academic}.section_id`,
    standardId: `${academic}.standard_id`,
    academicYearId: `${academic}.academic_year_id`,
  });
}

export function guardianReadPredicate(ability: AppAbility) {
  const restriction = guardianLinkedReadPredicate(ability, true);
  if (!restriction) return undefined;
  return sql`EXISTS (
    SELECT 1 FROM ${guardianProfilesLive} AS guardian_scope_profile
    LEFT JOIN ${studentGuardianLinks} AS guardian_scope_link
      ON guardian_scope_link.guardian_profile_id = guardian_scope_profile.id
    LEFT JOIN ${studentProfilesLive} AS guardian_scope_student
      ON guardian_scope_student.id = guardian_scope_link.student_profile_id
    LEFT JOIN ${studentAcademicsLive} AS guardian_scope_academic
      ON guardian_scope_academic.student_profile_id = guardian_scope_student.id
      AND guardian_scope_academic.academic_year_id IN (
        SELECT id FROM ${academicYearsLive} WHERE is_active = true
      )
    WHERE guardian_scope_profile.id = ${guardianProfilesLive.id} AND ${restriction}
  )`;
}
