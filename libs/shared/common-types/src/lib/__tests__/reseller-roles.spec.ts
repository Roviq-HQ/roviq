import { describe, expect, it } from 'vitest';
import {
  assignableResellerRoleNames,
  canManageResellerMember,
  resellerRoleAfterTierChange,
  resellerRoleRank,
} from '../reseller-roles';

describe('resellerRoleRank', () => {
  it('orders full admin above support admin above viewer', () => {
    expect(resellerRoleRank('reseller_full_admin')).toBe(3);
    expect(resellerRoleRank('reseller_support_admin')).toBe(2);
    expect(resellerRoleRank('reseller_viewer')).toBe(1);
  });

  it.each([
    null,
    undefined,
    '',
    'institute_admin',
    'platform_admin',
  ])('gives 0 to a role outside the ladder: %s', (name) => {
    expect(resellerRoleRank(name)).toBe(0);
  });
});

describe('assignableResellerRoleNames', () => {
  it('lets a full admin of a full-management reseller hand out every role', () => {
    expect(assignableResellerRoleNames('reseller_full_admin', 'FULL_MANAGEMENT')).toEqual([
      'reseller_full_admin',
      'reseller_support_admin',
      'reseller_viewer',
    ]);
  });

  it('stops a support admin at their own role', () => {
    expect(assignableResellerRoleNames('reseller_support_admin', 'FULL_MANAGEMENT')).toEqual([
      'reseller_support_admin',
      'reseller_viewer',
    ]);
  });

  it('stops everyone at the tier of the reseller', () => {
    expect(assignableResellerRoleNames('reseller_full_admin', 'SUPPORT_MANAGEMENT')).toEqual([
      'reseller_support_admin',
      'reseller_viewer',
    ]);
    expect(assignableResellerRoleNames('reseller_full_admin', 'READ_ONLY')).toEqual([
      'reseller_viewer',
    ]);
  });

  it.each([
    'reseller_viewer',
    'institute_admin',
    null,
    undefined,
  ])('gives nothing to %s', (name) => {
    expect(assignableResellerRoleNames(name, 'FULL_MANAGEMENT')).toEqual([]);
  });
});

describe('canManageResellerMember', () => {
  it.each([
    ['reseller_full_admin', 'reseller_full_admin', true],
    ['reseller_full_admin', 'reseller_support_admin', true],
    ['reseller_full_admin', 'reseller_viewer', true],
    ['reseller_support_admin', 'reseller_full_admin', false],
    ['reseller_support_admin', 'reseller_support_admin', true],
    ['reseller_support_admin', 'reseller_viewer', true],
    ['reseller_viewer', 'reseller_viewer', false],
    ['reseller_viewer', 'reseller_support_admin', false],
  ])('%s managing %s → %s', (actor, target, expected) => {
    expect(canManageResellerMember(actor, target)).toBe(expected);
  });

  it('refuses a member whose role is outside the ladder', () => {
    expect(canManageResellerMember('reseller_full_admin', 'custom_role')).toBe(false);
    expect(canManageResellerMember('reseller_full_admin', null)).toBe(false);
  });
});

describe('resellerRoleAfterTierChange', () => {
  it('moves holders of the old top role to the new top role, up or down', () => {
    expect(resellerRoleAfterTierChange('reseller_full_admin', 'FULL_MANAGEMENT', 'READ_ONLY')).toBe(
      'reseller_viewer',
    );
    expect(resellerRoleAfterTierChange('reseller_viewer', 'READ_ONLY', 'FULL_MANAGEMENT')).toBe(
      'reseller_full_admin',
    );
    expect(
      resellerRoleAfterTierChange(
        'reseller_support_admin',
        'SUPPORT_MANAGEMENT',
        'FULL_MANAGEMENT',
      ),
    ).toBe('reseller_full_admin');
  });

  it('does not promote a member who was deliberately below the old top role', () => {
    expect(
      resellerRoleAfterTierChange('reseller_viewer', 'SUPPORT_MANAGEMENT', 'FULL_MANAGEMENT'),
    ).toBe('reseller_viewer');
    expect(
      resellerRoleAfterTierChange('reseller_support_admin', 'FULL_MANAGEMENT', 'FULL_MANAGEMENT'),
    ).toBe('reseller_support_admin');
  });

  it('brings a member left above the new tier down to it', () => {
    expect(
      resellerRoleAfterTierChange('reseller_support_admin', 'FULL_MANAGEMENT', 'READ_ONLY'),
    ).toBe('reseller_viewer');
  });

  it('keeps a member already within the new tier', () => {
    expect(
      resellerRoleAfterTierChange('reseller_viewer', 'FULL_MANAGEMENT', 'SUPPORT_MANAGEMENT'),
    ).toBe('reseller_viewer');
  });
});
