import { caslToSqlWhere } from '@roviq/casl';
import type { AppAbility, AppAction } from '@roviq/common-types';
import {
  attendanceEntriesLive,
  attendanceSessionsLive,
  sectionsLive,
  studentProfilesLive,
} from '@roviq/database';
import { type AnyColumn, and, eq, exists, sql } from 'drizzle-orm';
import { alias, QueryBuilder } from 'drizzle-orm/pg-core';

const scopeSection = alias(sectionsLive, 'att_scope_section');
const scopeSession = alias(attendanceSessionsLive, 'att_scope_session');
const scopeEntry = alias(attendanceEntriesLive, 'att_scope_entry');
const scopeStudent = alias(studentProfilesLive, 'att_scope_student');

// Section columns are canonical: opening a session validates its year against the section.
const COLUMNS = {
  tenantId: scopeSection.tenantId,
  sectionId: scopeSection.id,
  standardId: scopeSection.standardId,
  academicYearId: scopeSection.academicYearId,
  lecturerId: scopeSession.lecturerId,
  date: scopeSession.date,
  studentId: scopeEntry.studentId,
  studentProfileId: scopeStudent.id,
};

const qb = new QueryBuilder();

function restriction(ability: AppAbility, action: AppAction) {
  return caslToSqlWhere(ability, action, 'Attendance', COLUMNS);
}

export function sectionInScope(ability: AppAbility, action: AppAction, sectionId: AnyColumn) {
  const allowed = restriction(ability, action);
  if (!allowed) return undefined;
  return exists(
    qb
      .select({ one: sql`1` })
      .from(scopeSection)
      .leftJoin(scopeSession, eq(scopeSession.sectionId, scopeSection.id))
      .leftJoin(scopeEntry, eq(scopeEntry.sessionId, scopeSession.id))
      .leftJoin(scopeStudent, eq(scopeStudent.membershipId, scopeEntry.studentId))
      .where(and(eq(scopeSection.id, sectionId), allowed)),
  );
}

export function sessionInScope(ability: AppAbility, action: AppAction, sessionId: AnyColumn) {
  const allowed = restriction(ability, action);
  if (!allowed) return undefined;
  return exists(
    qb
      .select({ one: sql`1` })
      .from(scopeSession)
      .innerJoin(scopeSection, eq(scopeSection.id, scopeSession.sectionId))
      .leftJoin(scopeEntry, eq(scopeEntry.sessionId, scopeSession.id))
      .leftJoin(scopeStudent, eq(scopeStudent.membershipId, scopeEntry.studentId))
      .where(and(eq(scopeSession.id, sessionId), allowed)),
  );
}

export function entryInScope(ability: AppAbility, action: AppAction, entryId: AnyColumn) {
  const allowed = restriction(ability, action);
  if (!allowed) return undefined;
  return exists(
    qb
      .select({ one: sql`1` })
      .from(scopeEntry)
      .innerJoin(scopeSession, eq(scopeSession.id, scopeEntry.sessionId))
      .innerJoin(scopeSection, eq(scopeSection.id, scopeSession.sectionId))
      .leftJoin(scopeStudent, eq(scopeStudent.membershipId, scopeEntry.studentId))
      .where(and(eq(scopeEntry.id, entryId), allowed)),
  );
}
