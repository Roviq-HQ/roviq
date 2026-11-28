import { describe, expect, it } from 'vitest';
import { type MigrationRole, migrationRoleProblems } from '../check-migration-role';

const role = (over: Partial<MigrationRole>): MigrationRole => ({
  name: 'deployer',
  superuser: false,
  createRole: true,
  bypassRls: true,
  inAdminRole: true,
  ...over,
});

describe('migrationRoleProblems', () => {
  it('should accept a superuser whatever else is set', () => {
    expect(
      migrationRoleProblems(
        role({ superuser: true, createRole: false, bypassRls: false, inAdminRole: false }),
        undefined,
      ),
    ).toEqual([]);
  });

  it('should refuse a role that is not a superuser when no administrative role is named', () => {
    const problems = migrationRoleProblems(role({}), undefined);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"deployer" is not a superuser');
    expect(problems[0]).toContain('MIGRATION_ADMIN_ROLE');
  });

  it('should accept a member of the named administrative role that may create roles and bypass row security', () => {
    expect(migrationRoleProblems(role({}), 'service_admin')).toEqual([]);
  });

  it.each([
    ['inAdminRole', 'GRANT "service_admin" TO "deployer"'],
    ['createRole', 'ALTER ROLE "deployer" CREATEROLE'],
    ['bypassRls', 'ALTER ROLE "deployer" BYPASSRLS'],
  ] as const)('should name the statement that fixes a missing %s', (right, statement) => {
    const problems = migrationRoleProblems(role({ [right]: false }), 'service_admin');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(statement);
  });

  it('should list every missing right at once', () => {
    expect(
      migrationRoleProblems(
        role({ inAdminRole: false, createRole: false, bypassRls: false }),
        'service_admin',
      ),
    ).toHaveLength(3);
  });
});
