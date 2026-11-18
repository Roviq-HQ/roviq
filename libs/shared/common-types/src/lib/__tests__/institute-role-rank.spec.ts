import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLE_ABILITIES,
  DefaultRoles,
  INSTITUTE_ROLE_RANK,
  instituteRoleRank,
} from '../common-types';

describe('instituteRoleRank', () => {
  it('should rank every default role', () => {
    expect(Object.keys(INSTITUTE_ROLE_RANK).sort()).toEqual(
      [...new Set(Object.values(DefaultRoles))].sort(),
    );
  });

  it('should order the leadership chain above staff, and staff above students and parents', () => {
    const rank = (role: keyof typeof INSTITUTE_ROLE_RANK) =>
      instituteRoleRank(role, DEFAULT_ROLE_ABILITIES[role]);

    expect(rank('institute_admin')).toBeGreaterThan(rank('principal'));
    expect(rank('principal')).toBeGreaterThan(rank('vice_principal'));
    expect(rank('vice_principal')).toBeGreaterThan(rank('class_teacher'));
    expect(rank('class_teacher')).toBeGreaterThan(rank('support_staff'));
    expect(rank('support_staff')).toBeGreaterThan(rank('student'));
    expect(rank('student')).toBe(rank('parent'));
  });

  it('should rank a role that grants manage:all with the institute admin whatever its name', () => {
    const fullControl = [{ action: 'manage', subject: 'all' }];

    expect(instituteRoleRank('custom_owner', fullControl)).toBe(
      INSTITUTE_ROLE_RANK.institute_admin,
    );
    expect(instituteRoleRank('student', fullControl)).toBe(INSTITUTE_ROLE_RANK.institute_admin);
  });

  it('should rank an unknown custom role as staff', () => {
    const rank = instituteRoleRank('lab_volunteer', [{ action: 'read', subject: 'Student' }]);

    expect(rank).toBe(INSTITUTE_ROLE_RANK.class_teacher);
    expect(rank).toBeLessThan(INSTITUTE_ROLE_RANK.principal);
    expect(rank).toBeGreaterThan(INSTITUTE_ROLE_RANK.student);
  });

  it('should not treat inherited object keys as role names', () => {
    expect(instituteRoleRank('toString', [])).toBe(INSTITUTE_ROLE_RANK.class_teacher);
  });

  it('should let only the institute admin and the principal impersonate by default', () => {
    const canImpersonate = Object.entries(DEFAULT_ROLE_ABILITIES)
      .filter(([, rules]) =>
        rules.some(
          (rule) =>
            (rule.action === 'impersonate' && rule.subject === 'User') ||
            (rule.action === 'manage' && rule.subject === 'all'),
        ),
      )
      .map(([role]) => role)
      .sort();

    expect(canImpersonate).toEqual(['institute_admin', 'principal']);
  });
});
