import { createMongoAbility, type RawRuleOf } from '@casl/ability';
import type { AppAbility } from '@roviq/common-types';
import { describe, expect, it } from 'vitest';
import { firstSettingsPage } from '../settings-entry';

function abilityWith(rules: RawRuleOf<AppAbility>[]) {
  return createMongoAbility<AppAbility>(rules);
}

describe('firstSettingsPage', () => {
  it('opens institute settings for a role that can read the institute', () => {
    expect(firstSettingsPage(abilityWith([{ action: 'manage', subject: 'all' }]))).toBe(
      '/settings/institute',
    );
  });

  it('opens consent for a guardian-like role that can read only consent', () => {
    expect(firstSettingsPage(abilityWith([{ action: 'read', subject: 'Consent' }]))).toBe(
      '/settings/consent',
    );
  });

  it('opens roles when that is the only settings data the role may read', () => {
    expect(firstSettingsPage(abilityWith([{ action: 'read', subject: 'Role' }]))).toBe(
      '/settings/roles',
    );
  });

  it('falls back to sessions, which every signed-in user may manage', () => {
    expect(firstSettingsPage(abilityWith([{ action: 'read', subject: 'Student' }]))).toBe(
      '/settings/sessions',
    );
  });
});
