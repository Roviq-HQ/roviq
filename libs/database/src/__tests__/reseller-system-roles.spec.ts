import { createMongoAbility } from '@casl/ability';
import { describe, expect, it } from 'vitest';
import {
  RESELLER_SYSTEM_ROLE_ABILITIES,
  RESELLER_SYSTEM_ROLE_NAMES,
} from '../reseller-system-roles';

// Security invariant (ROV-102): deleting an institute is a platform decision.
describe('reseller system roles', () => {
  it.each(RESELLER_SYSTEM_ROLE_NAMES)('%s cannot delete or restore an institute', (name) => {
    const ability = createMongoAbility(RESELLER_SYSTEM_ROLE_ABILITIES[name]);

    expect(ability.can('delete', 'Institute')).toBe(false);
    expect(ability.can('restore', 'Institute')).toBe(false);
  });

  it.each(RESELLER_SYSTEM_ROLE_NAMES)('%s has no manage-all grant', (name) => {
    const ability = createMongoAbility(RESELLER_SYSTEM_ROLE_ABILITIES[name]);

    expect(ability.can('manage', 'all')).toBe(false);
  });

  // ROV-284: explicit lists. Gateway configurations hold API keys.
  it.each([
    'reseller_support_admin',
    'reseller_viewer',
  ] as const)('%s cannot read payment gateway configurations, audit logs or payments', (name) => {
    const ability = createMongoAbility(RESELLER_SYSTEM_ROLE_ABILITIES[name]);

    expect(ability.can('read', 'PaymentGatewayConfig')).toBe(false);
    expect(ability.can('read', 'AuditLog')).toBe(false);
    expect(ability.can('read', 'Payment')).toBe(false);
    expect(ability.can('read', 'all')).toBe(false);
  });

  it('should let a viewer read institutes, statistics and billing, and nothing about people', () => {
    const ability = createMongoAbility(RESELLER_SYSTEM_ROLE_ABILITIES.reseller_viewer);

    expect(ability.can('read', 'Institute')).toBe(true);
    expect(ability.can('view_statistics', 'Institute')).toBe(true);
    expect(ability.can('read', 'InstituteGroup')).toBe(true);
    expect(ability.can('read', 'BillingDashboard')).toBe(true);
    expect(ability.can('read', 'Subscription')).toBe(true);
    expect(ability.can('read', 'Invoice')).toBe(true);
    expect(ability.can('read', 'User')).toBe(false);
    expect(ability.can('read', 'ResellerTeam')).toBe(false);
    expect(ability.can('impersonate', 'User')).toBe(false);
  });

  it('should give support admins what a viewer has plus users, impersonation and the team', () => {
    const ability = createMongoAbility(RESELLER_SYSTEM_ROLE_ABILITIES.reseller_support_admin);

    for (const rule of RESELLER_SYSTEM_ROLE_ABILITIES.reseller_viewer) {
      expect(ability.can(rule.action, rule.subject)).toBe(true);
    }
    expect(ability.can('read', 'User')).toBe(true);
    expect(ability.can('impersonate', 'User')).toBe(true);
    expect(ability.can('read', 'ResellerTeam')).toBe(true);
    expect(ability.can('update', 'Institute')).toBe(false);
    expect(ability.can('read', 'Reseller')).toBe(false);
  });
});
