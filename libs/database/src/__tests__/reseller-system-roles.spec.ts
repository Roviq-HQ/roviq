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
});
