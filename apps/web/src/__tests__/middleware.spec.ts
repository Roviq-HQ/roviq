// @vitest-environment node

import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { middleware } from '../middleware';

describe('locale and portal middleware', () => {
  it('should detect Hindi from browser preferences on a bare URL', () => {
    const response = middleware(
      new NextRequest('http://localhost:4202/account?tab=profile', {
        headers: { 'accept-language': 'hi-IN,hi;q=0.9,en;q=0.8' },
      }),
    );
    expect(response.headers.get('location')).toBe('http://localhost:4202/hi/account?tab=profile');
  });
  it('should honor an explicit locale over browser preferences', () => {
    const response = middleware(
      new NextRequest('http://localhost:4202/en/institute/account', {
        headers: { 'accept-language': 'hi' },
      }),
    );
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-middleware-request-x-next-intl-locale')).toBe('en');
  });
  it('should reuse a locale cookie on subsequent visits', () => {
    const response = middleware(
      new NextRequest('http://localhost:4202/account', {
        headers: { cookie: 'NEXT_LOCALE=hi', 'accept-language': 'en' },
      }),
    );
    expect(response.headers.get('location')).toBe('http://localhost:4202/hi/account');
  });
  it.each(['admin', 'reseller'])('should preserve hostname portal rewrites for %s', (scope) => {
    const response = middleware(
      new NextRequest(`http://${scope}.localhost:4202/hi/account?tab=profile`, {
        headers: { host: `${scope}.localhost:4202` },
      }),
    );
    expect(response.headers.get('x-middleware-rewrite')).toBe(
      `http://${scope}.localhost:4202/hi/${scope}/account?tab=profile`,
    );
  });
});
