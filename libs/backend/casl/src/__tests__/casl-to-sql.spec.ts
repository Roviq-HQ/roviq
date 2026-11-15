/**
 * Unit tests for CASL-to-SQL bridge (ROV-166).
 *
 * Tests the full pipeline: CASL ability → rulesToAST → @ucast/sql → Drizzle SQL.
 */
import { createMongoAbility } from '@casl/ability';
import type { AbilityRule, AppAbility } from '@roviq/common-types';
import { PgDialect, pgTable, uuid } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { caslToSqlWhere } from '../casl-to-sql';
import { substituteUserVars } from '../substitute-user-vars';

const studentProfiles = pgTable('student_profiles_live', {
  id: uuid().primaryKey(),
  userId: uuid('user_id'),
  sectionId: uuid('section_id'),
});
const COLUMNS = {
  id: studentProfiles.id,
  userId: studentProfiles.userId,
  sectionId: studentProfiles.sectionId,
};

function buildAbility(rules: AbilityRule[]): AppAbility {
  return createMongoAbility<AppAbility>(rules);
}

/** Typed shape for CASL $in operator conditions (pre- or post-substitution) */
interface InCondition {
  $in: string | unknown[];
}

/** Typed shape for a CASL condition entry with nested properties */
interface NestedCondition {
  userId?: string;
  sectionId?: InCondition;
}

describe('caslToSqlWhere', () => {
  it.each([
    { condition: { sectionId: { $in: [] } }, expected: 'false' },
    { condition: { sectionId: { $nin: [] } }, expected: 'true' },
  ])('compiles empty membership conditions to $expected', ({ condition, expected }) => {
    const ability = buildAbility([{ action: 'read', subject: 'Student', conditions: condition }]);
    const result = caslToSqlWhere(ability, 'read', 'Student', COLUMNS);
    if (!result) throw new Error('Expected a constant predicate');
    expect(new PgDialect().sqlToQuery(result)).toEqual({ sql: expected, params: [] });
  });
  it('qualifies joined columns without interpolating condition values', () => {
    const ability = buildAbility([
      { action: 'read', subject: 'Student', conditions: { userId: 'user-123' } },
    ]);
    const result = caslToSqlWhere(ability, 'read', 'Student', COLUMNS);
    expect(result).toBeDefined();
    if (!result) throw new Error('Expected a restricted query');
    const query = new PgDialect().sqlToQuery(result);
    expect(query.sql).toBe('"student_profiles_live"."user_id" = $1');
    expect(query.params).toEqual(['user-123']);
  });

  it('keeps deny rules when compiling a joined row predicate', () => {
    const ability = buildAbility([
      { action: 'read', subject: 'Student' },
      {
        action: 'read',
        subject: 'Student',
        inverted: true,
        conditions: { userId: 'blocked-user' },
      },
    ]);
    const result = caslToSqlWhere(ability, 'read', 'Student', COLUMNS);
    if (!result) throw new Error('Expected a deny predicate');
    const query = new PgDialect().sqlToQuery(result);
    expect(query.sql).toContain('"student_profiles_live"."user_id"');
    expect(query.params).toEqual(['blocked-user']);
  });

  it('manage:all (institute_admin) → undefined (no restriction)', () => {
    const ability = buildAbility([{ action: 'manage', subject: 'all' }]);
    const result = caslToSqlWhere(ability, 'read', 'Student', COLUMNS);
    expect(result).toBeUndefined();
  });

  it('unconditional read:Student → undefined (no restriction)', () => {
    const ability = buildAbility([{ action: 'read', subject: 'Student' }]);
    const result = caslToSqlWhere(ability, 'read', 'Student', COLUMNS);
    expect(result).toBeUndefined();
  });

  it('renders the mapped Drizzle column for each condition field', () => {
    const ability = buildAbility([
      { action: 'read', subject: 'Student', conditions: { sectionId: { $in: ['a', 'b'] } } },
    ]);
    const result = caslToSqlWhere(ability, 'read', 'Student', COLUMNS);
    if (!result) throw new Error('Expected a restricted query');
    expect(new PgDialect().sqlToQuery(result)).toEqual({
      sql: '"student_profiles_live"."section_id" in($1, $2)',
      params: ['a', 'b'],
      typings: ['none', 'none'],
    });
  });

  it('fails closed when a condition field has no mapped column', () => {
    const ability = buildAbility([
      { action: 'read', subject: 'Student', conditions: { guardianId: 'g-1' } },
    ]);
    const result = caslToSqlWhere(ability, 'read', 'Student', COLUMNS);
    if (!result) throw new Error('Expected a deny predicate');
    expect(new PgDialect().sqlToQuery(result)).toEqual({ sql: 'false', params: [] });
  });

  it('class_teacher with sectionId $in condition → SQL produced', () => {
    const conditions = substituteUserVars(
      { sectionId: { $in: '$user.assignedSections' } },
      { userId: 'teacher-1', assignedSections: ['sec-a', 'sec-b'] },
    );
    const ability = buildAbility([{ action: 'read', subject: 'Student', conditions }]);
    const result = caslToSqlWhere(ability, 'read', 'Student', COLUMNS);
    expect(result).toBeDefined();
  });

  it('no matching rules → sql`false` (blocks access)', () => {
    const ability = buildAbility([{ action: 'read', subject: 'Attendance' }]);
    // Querying for Student when only Attendance is allowed → no access
    const result = caslToSqlWhere(ability, 'read', 'Student', COLUMNS);
    expect(result).toBeDefined(); // returns sql`false`, not undefined
  });

  it('no rules at all → sql`false`', () => {
    const ability = buildAbility([]);
    const result = caslToSqlWhere(ability, 'read', 'Student', COLUMNS);
    expect(result).toBeDefined();
  });
});

describe('substituteUserVars', () => {
  it('replaces $user.sub with userId', () => {
    const result = substituteUserVars({ userId: '$user.sub' }, { userId: 'abc-123' });
    expect(result.userId).toBe('abc-123');
  });

  it('replaces ${user.id} (legacy format) with userId', () => {
    const result = substituteUserVars({ studentId: '${user.id}' }, { userId: 'abc-123' });
    expect(result.studentId).toBe('abc-123');
  });

  it('replaces $user.assignedSections with array', () => {
    const result = substituteUserVars<{ sectionId: InCondition }>(
      { sectionId: { $in: '$user.assignedSections' } },
      { userId: 'u1', assignedSections: ['sec-1', 'sec-2'] },
    );
    expect(result.sectionId.$in).toEqual(['sec-1', 'sec-2']);
  });

  it('$user.assignedSections defaults to empty array when not provided', () => {
    const result = substituteUserVars<{ sectionId: InCondition }>(
      { sectionId: { $in: '$user.assignedSections' } },
      { userId: 'u1' },
    );
    expect(result.sectionId.$in).toEqual([]);
  });

  it('non-placeholder values are preserved', () => {
    const result = substituteUserVars({ status: 'enrolled', name: 'test' }, { userId: 'u1' });
    expect(result.status).toBe('enrolled');
    expect(result.name).toBe('test');
  });

  it('deeply nested substitution works', () => {
    const result = substituteUserVars<{ $and: NestedCondition[] }>(
      { $and: [{ userId: '$user.sub' }, { sectionId: { $in: '$user.assignedSections' } }] },
      { userId: 'u1', assignedSections: ['s1'] },
    );
    expect(result.$and[0].userId).toBe('u1');
    expect(result.$and[1].sectionId?.$in).toEqual(['s1']);
  });
});
