import { createMongoAbility } from '@casl/ability';
import { describe, expect, it } from 'vitest';
import { type AppAbility, type AppAction, DEFAULT_ROLE_ABILITIES } from '../common-types';

const ability = createMongoAbility<AppAbility>(DEFAULT_ROLE_ABILITIES.institute_admin);

const PLATFORM_INSTITUTE_ACTIONS: AppAction[] = [
  'create',
  'update',
  'delete',
  'restore',
  'approve',
  'reject',
  'activate',
  'deactivate',
  'suspend',
  'view_statistics',
];

describe('institute_admin default abilities (ROV-290)', () => {
  it.each(PLATFORM_INSTITUTE_ACTIONS)('cannot %s an Institute', (action) => {
    expect(ability.can(action, 'Institute')).toBe(false);
  });

  it.each([
    'read',
    'update_info',
    'update_branding',
    'update_config',
  ] as const)('can %s its Institute', (action) => {
    expect(ability.can(action, 'Institute')).toBe(true);
  });

  it.each([
    'create',
    'update',
    'delete',
    'manage',
  ] as const)('cannot %s an InstituteGroup', (action) => {
    expect(ability.can(action, 'InstituteGroup')).toBe(false);
  });

  it('can read an InstituteGroup', () => {
    expect(ability.can('read', 'InstituteGroup')).toBe(true);
  });

  it('keeps full control of tenant subjects', () => {
    expect(ability.can('manage', 'Student')).toBe(true);
    expect(ability.can('impersonate', 'User')).toBe(true);
  });
});
