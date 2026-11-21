import { describe, expect, it } from 'vitest';
import {
  failedPasswordRules,
  meetsPasswordRule,
  NEW_PASSWORD_MIN_LENGTH,
  PASSWORD_RULE_IDS,
} from '../password-policy';

describe('failedPasswordRules', () => {
  it('should accept a password that meets every rule', () => {
    expect(failedPasswordRules('Roviq2026')).toEqual([]);
  });

  it.each([
    ['too short', 'Ab1', ['MIN_LENGTH']],
    ['lower case only', 'abcdefgh1', ['MIXED_CASE']],
    ['upper case only', 'ABCDEFGH1', ['MIXED_CASE']],
    ['no digit', 'abcdefghIJ', ['NUMBER']],
    ['empty', '', ['MIN_LENGTH', 'MIXED_CASE', 'NUMBER']],
  ])('should name every failed rule for a password that is %s', (_case, password, expected) => {
    expect(failedPasswordRules(password)).toEqual(expected);
  });

  it('should count exactly the minimum length as long enough', () => {
    const atMinimum = `Aa1${'x'.repeat(NEW_PASSWORD_MIN_LENGTH - 3)}`;

    expect(atMinimum).toHaveLength(NEW_PASSWORD_MIN_LENGTH);
    expect(failedPasswordRules(atMinimum)).toEqual([]);
    expect(failedPasswordRules(atMinimum.slice(0, -1))).toEqual(['MIN_LENGTH']);
  });

  it('should treat Devanagari digits as numbers', () => {
    expect(meetsPasswordRule('Abcdefg२', 'NUMBER')).toBe(true);
  });
});

describe('PASSWORD_RULE_IDS', () => {
  it('should list the rules in checklist order', () => {
    expect(PASSWORD_RULE_IDS).toEqual(['MIN_LENGTH', 'MIXED_CASE', 'NUMBER']);
  });
});
