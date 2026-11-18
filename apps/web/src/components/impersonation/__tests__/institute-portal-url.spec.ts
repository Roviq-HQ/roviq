import { describe, expect, it } from 'vitest';
import { impersonationExchangeUrl, institutePortalOrigin } from '../institute-portal-url';

describe('institutePortalOrigin', () => {
  it.each([
    ['admin.localhost:4260', 'http://localhost:4260'],
    ['reseller.localhost:4260', 'http://localhost:4260'],
    ['localhost:4200', 'http://localhost:4200'],
    ['app.example.test', 'http://app.example.test'],
  ])('derives the institute host from %s', (host, expected) => {
    expect(institutePortalOrigin({ protocol: 'http:', host }, undefined)).toBe(expected);
  });

  it('does not strip a bare "admin" host with no domain after it', () => {
    expect(institutePortalOrigin({ protocol: 'http:', host: 'admin' }, undefined)).toBe(
      'http://admin',
    );
  });

  it('prefers the configured origin and drops a trailing slash', () => {
    expect(
      institutePortalOrigin(
        { protocol: 'https:', host: 'admin.roviq.com' },
        'https://app.roviq.com/',
      ),
    ).toBe('https://app.roviq.com');
  });
});

describe('impersonationExchangeUrl', () => {
  it('builds the localized exchange URL and encodes the code', () => {
    expect(impersonationExchangeUrl('http://localhost:4260', 'hi', 'a b/c')).toBe(
      'http://localhost:4260/hi/auth/impersonate?code=a%20b%2Fc',
    );
  });
});
