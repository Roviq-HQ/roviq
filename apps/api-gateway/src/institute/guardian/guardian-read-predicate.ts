import { caslToSqlWhere } from '@roviq/casl';
import type { AppAbility } from '@roviq/common-types';
import {
  guardianProfilesLive,
  studentAcademicsLive,
  studentGuardianLinksLive,
  studentProfilesLive,
} from '@roviq/database';
import { and, eq, exists, inArray, sql } from 'drizzle-orm';
import { alias, QueryBuilder } from 'drizzle-orm/pg-core';
import { activeAcademicYearIds } from '../student/student-read-predicate';

const qb = new QueryBuilder();
const scopeProfile = alias(guardianProfilesLive, 'guardian_scope_profile');
const scopeLink = alias(studentGuardianLinksLive, 'guardian_scope_link');
const scopeStudent = alias(studentProfilesLive, 'guardian_scope_student');
const scopeAcademic = alias(studentAcademicsLive, 'guardian_scope_academic');

export function guardianLinkedReadPredicate(ability: AppAbility, correlated = false) {
  return caslToSqlWhere(
    ability,
    'read',
    'Guardian',
    correlated
      ? {
          id: scopeProfile.id,
          userId: scopeProfile.userId,
          membershipId: scopeProfile.membershipId,
          tenantId: scopeProfile.tenantId,
          sectionId: scopeAcademic.sectionId,
          standardId: scopeAcademic.standardId,
          academicYearId: scopeAcademic.academicYearId,
        }
      : {
          id: guardianProfilesLive.id,
          userId: guardianProfilesLive.userId,
          membershipId: guardianProfilesLive.membershipId,
          tenantId: guardianProfilesLive.tenantId,
          sectionId: studentAcademicsLive.sectionId,
          standardId: studentAcademicsLive.standardId,
          academicYearId: studentAcademicsLive.academicYearId,
        },
  );
}

export function guardianReadPredicate(ability: AppAbility) {
  const restriction = guardianLinkedReadPredicate(ability, true);
  if (!restriction) return undefined;
  return exists(
    qb
      .select({ one: sql`1` })
      .from(scopeProfile)
      .leftJoin(scopeLink, eq(scopeLink.guardianProfileId, scopeProfile.id))
      .leftJoin(scopeStudent, eq(scopeStudent.id, scopeLink.studentProfileId))
      .leftJoin(
        scopeAcademic,
        and(
          eq(scopeAcademic.studentProfileId, scopeStudent.id),
          inArray(scopeAcademic.academicYearId, activeAcademicYearIds()),
        ),
      )
      .where(and(eq(scopeProfile.id, guardianProfilesLive.id), restriction)),
  );
}
