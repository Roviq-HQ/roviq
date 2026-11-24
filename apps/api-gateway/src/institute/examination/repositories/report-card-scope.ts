import { caslToSqlWhere } from '@roviq/casl';
import type { AppAbility } from '@roviq/common-types';
import { reportCardInstancesLive, studentProfilesLive } from '@roviq/database';
import { type AnyColumn, and, eq, exists, type SQL, sql } from 'drizzle-orm';
import { alias, QueryBuilder } from 'drizzle-orm/pg-core';

const qb = new QueryBuilder();
const scopeInstance = alias(reportCardInstancesLive, 'report_card_scope_instance');
const scopeStudent = alias(studentProfilesLive, 'report_card_scope_student');

/**
 * True for the report card instances the ability may read. Students and parents hold
 * conditional rules (their own or their children's published cards); undefined when the
 * ability is unrestricted.
 */
export function reportCardInstanceInScope(
  ability: AppAbility,
  instanceId: AnyColumn,
): SQL | undefined {
  const allowed = caslToSqlWhere(ability, 'read', 'ReportCard', {
    id: scopeInstance.id,
    tenantId: scopeInstance.tenantId,
    reportCardId: scopeInstance.reportCardId,
    studentProfileId: scopeInstance.studentProfileId,
    sectionId: scopeInstance.sectionId,
    academicYearId: scopeInstance.academicYearId,
    status: scopeInstance.status,
    userId: scopeStudent.userId,
  });
  if (!allowed) return undefined;
  return exists(
    qb
      .select({ one: sql`1` })
      .from(scopeInstance)
      .innerJoin(scopeStudent, eq(scopeStudent.id, scopeInstance.studentProfileId))
      .where(and(eq(scopeInstance.id, instanceId), allowed)),
  );
}
