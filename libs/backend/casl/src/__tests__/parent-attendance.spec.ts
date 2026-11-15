import { createMongoAbility } from '@casl/ability';
import { type AppAbility, DEFAULT_ROLE_ABILITIES } from '@roviq/common-types';
import { PgDialect, pgTable, uuid } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { caslToSqlWhere } from '../casl-to-sql';
import { substituteUserVars } from '../substitute-user-vars';

const attendance = pgTable('attendance_scope', { studentProfileId: uuid('student_profile_id') });
const COLUMNS = { studentProfileId: attendance.studentProfileId };

function parentAbility(linkedStudentIds: string[]): AppAbility {
  return createMongoAbility<AppAbility>(
    DEFAULT_ROLE_ABILITIES.parent.map((rule) =>
      rule.conditions
        ? {
            ...rule,
            conditions: substituteUserVars(rule.conditions, {
              userId: 'parent-user',
              linkedStudentIds,
            }),
          }
        : rule,
    ),
  );
}

describe('parent attendance policy', () => {
  it('should restrict attendance to linked children', () => {
    const result = caslToSqlWhere(parentAbility(['child-1']), 'read', 'Attendance', COLUMNS);

    if (!result) throw new Error('Expected a restricted predicate');
    expect(new PgDialect().sqlToQuery(result)).toEqual({
      sql: '"attendance_scope"."student_profile_id" in($1)',
      params: ['child-1'],
      typings: ['none'],
    });
  });

  it('should deny all attendance without a linked child', () => {
    const result = caslToSqlWhere(parentAbility([]), 'read', 'Attendance', COLUMNS);

    if (!result) throw new Error('Expected a deny predicate');
    expect(new PgDialect().sqlToQuery(result)).toEqual({ sql: 'false', params: [] });
  });
});
