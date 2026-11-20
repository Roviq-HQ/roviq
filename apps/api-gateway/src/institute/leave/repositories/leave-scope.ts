import { caslToSqlWhere } from '@roviq/casl';
import type { AppAbility, AppAction } from '@roviq/common-types';
import {
  leavesLive,
  membershipsLive,
  studentAcademicsLive,
  studentProfilesLive,
} from '@roviq/database';
import { type AnyColumn, and, eq, exists, inArray, type SQL, sql } from 'drizzle-orm';
import { alias, QueryBuilder } from 'drizzle-orm/pg-core';
import { activeAcademicYearIds } from '../../student/student-read-predicate';

const qb = new QueryBuilder();
const scopeLeave = alias(leavesLive, 'leave_scope_leave');
const scopeMember = alias(membershipsLive, 'leave_scope_member');
const scopeStudent = alias(studentProfilesLive, 'leave_scope_student');
const scopeAcademic = alias(studentAcademicsLive, 'leave_scope_academic');

// A leave is for a membership. When that membership is a student, section rules use the
// student's enrolment in the active year and guardian rules use the student profile.
const APPLICANT_COLUMNS = {
  studentProfileId: scopeStudent.id,
  sectionId: scopeAcademic.sectionId,
  standardId: scopeAcademic.standardId,
};

const academicOfStudent = and(
  eq(scopeAcademic.studentProfileId, scopeStudent.id),
  inArray(scopeAcademic.academicYearId, activeAcademicYearIds()),
);

/**
 * True for the leaves the ability's rules for `action` cover. Undefined when the
 * ability is unrestricted for that action.
 */
export function leaveInScope(
  ability: AppAbility,
  action: AppAction,
  leaveId: AnyColumn,
): SQL | undefined {
  const allowed = caslToSqlWhere(ability, action, 'Leave', {
    id: scopeLeave.id,
    tenantId: scopeLeave.tenantId,
    userId: scopeLeave.userId,
    status: scopeLeave.status,
    ...APPLICANT_COLUMNS,
  });
  if (!allowed) return undefined;
  return exists(
    qb
      .select({ one: sql`1` })
      .from(scopeLeave)
      .leftJoin(scopeStudent, eq(scopeStudent.membershipId, scopeLeave.userId))
      .leftJoin(scopeAcademic, academicOfStudent)
      .where(and(eq(scopeLeave.id, leaveId), allowed)),
  );
}

/**
 * True when the ability may file a leave for this membership of the caller's institute.
 * Always a real check: an unrestricted ability must still name a membership that exists.
 */
export function mayApplyFor(ability: AppAbility, membershipId: string): SQL {
  const allowed = caslToSqlWhere(ability, 'create', 'Leave', {
    tenantId: scopeMember.tenantId,
    userId: scopeMember.id,
    ...APPLICANT_COLUMNS,
  });
  return exists(
    qb
      .select({ one: sql`1` })
      .from(scopeMember)
      .leftJoin(scopeStudent, eq(scopeStudent.membershipId, scopeMember.id))
      .leftJoin(scopeAcademic, academicOfStudent)
      .where(and(eq(scopeMember.id, membershipId), allowed)),
  );
}
