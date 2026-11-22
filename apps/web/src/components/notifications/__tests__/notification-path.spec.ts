import { describe, expect, it } from 'vitest';
import { notificationPath } from '../notification-path';

describe('notificationPath', () => {
  it.each([
    ['institute', '/institute/attendance'],
    ['institute', '/institute/account'],
    ['reseller', '/reseller/account'],
    ['platform', '/admin/institutes/019a0000-0000-7000-8000-000000000001'],
  ] as const)('accepts %s route %s', (scope, path) => {
    expect(notificationPath({ path }, scope)).toBe(path);
  });

  it.each([
    ['an absolute URL', 'https://evil.example/institute/attendance'],
    ['a protocol-relative URL', '//evil.example/institute'],
    ['a backslash host', '/\\evil.example'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['another portal', '/admin/institutes'],
    ['a path that climbs out', '/institute/../admin'],
    ['a query string', '/institute/attendance?next=https://evil.example'],
    ['a trailing slash', '/institute/'],
    ['a relative path', 'institute/attendance'],
  ])('rejects %s', (_label, path) => {
    expect(notificationPath({ path }, 'institute')).toBeNull();
  });

  it('rejects missing data and a non-string path', () => {
    expect(notificationPath(null, 'institute')).toBeNull();
    expect(notificationPath({}, 'institute')).toBeNull();
    expect(notificationPath({ path: 42 }, 'institute')).toBeNull();
  });
});
