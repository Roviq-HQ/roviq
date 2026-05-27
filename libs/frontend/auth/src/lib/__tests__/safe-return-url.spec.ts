import { describe, expect, it } from 'vitest';
import { sanitizeReturnUrl } from '../safe-return-url';

describe('sanitizeReturnUrl', () => {
  it('accepts same-origin relative paths', () => {
    expect(sanitizeReturnUrl('/institute/people/students/123')).toBe(
      '/institute/people/students/123',
    );
    expect(sanitizeReturnUrl('/en/institute/dashboard?tab=x')).toBe(
      '/en/institute/dashboard?tab=x',
    );
  });

  it('rejects absolute URLs (open-redirect)', () => {
    expect(sanitizeReturnUrl('https://evil.com')).toBeNull();
    expect(sanitizeReturnUrl('http://evil.com/path')).toBeNull();
  });

  it('rejects protocol-relative and backslash variants that resolve off-origin', () => {
    expect(sanitizeReturnUrl('//evil.com')).toBeNull();
    expect(sanitizeReturnUrl('/\\evil.com')).toBeNull();
  });

  it('rejects empty / nullish / non-rooted values', () => {
    expect(sanitizeReturnUrl(null)).toBeNull();
    expect(sanitizeReturnUrl(undefined)).toBeNull();
    expect(sanitizeReturnUrl('')).toBeNull();
    expect(sanitizeReturnUrl('relative/path')).toBeNull();
  });
});
