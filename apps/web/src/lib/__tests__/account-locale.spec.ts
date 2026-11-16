import { describe, expect, it } from 'vitest';
import { resolveAccountLocale } from '../account-locale';

describe('resolveAccountLocale', () => {
  it('should prioritize the saved account language', () => {
    expect(resolveAccountLocale('hi', ['en-IN'])).toBe('hi');
  });
  it('should match browser language variants in preference order', () => {
    expect(resolveAccountLocale(null, ['fr-FR', 'hi-IN', 'en'])).toBe('hi');
  });
  it('should fall back to English without a supported language', () => {
    expect(resolveAccountLocale(null, ['fr-FR'])).toBe('en');
    expect(resolveAccountLocale('invalid', [])).toBe('en');
  });
});
