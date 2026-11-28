// @vitest-environment node
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { middleware, scopeOfHost, scopeOfPath } from '../middleware';

const REWRITE = 'x-middleware-rewrite';

function visit(host: string, path: string) {
  return middleware(new NextRequest(`http://${host}${path}`, { headers: { host } }));
}

/** The path the app renders for this request (the request's own when nothing was rewritten). */
function served(host: string, path: string): string {
  const rewritten = visit(host, path).headers.get(REWRITE);
  return rewritten ? new URL(rewritten).pathname : path;
}

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
    // The locale next-intl resolved still reaches the rewritten page.
    expect(response.headers.get('x-middleware-request-x-next-intl-locale')).toBe('hi');
  });
});

describe('scopeOfHost', () => {
  it.each([
    ['admin.localhost:4200', 'admin'],
    ['reseller.localhost:4200', 'reseller'],
    ['localhost:4200', 'institute'],
    ['admin.example.test', 'admin'],
    ['reseller.example.test', 'reseller'],
    ['app.example.test', 'institute'],
    ['administration.example.test', 'institute'],
    ['', 'institute'],
  ])('should serve %s as the %s portal', (host, scope) => {
    expect(scopeOfHost(host)).toBe(scope);
  });
});

describe('scopeOfPath', () => {
  it.each([
    ['/admin/dashboard', 'admin'],
    ['/admin', 'admin'],
    ['/reseller/institutes', 'reseller'],
    ['/institute/people', 'institute'],
    ['/administration', null],
    ['/dashboard', null],
    ['/', null],
  ])('should read %s as %s', (path, scope) => {
    expect(scopeOfPath(path)).toBe(scope);
  });
});

describe('middleware: one portal per host', () => {
  it.each([
    ['localhost:4200', '/en/dashboard', '/en/institute/dashboard'],
    ['localhost:4200', '/en', '/en/institute/login'],
    ['admin.localhost:4200', '/en/institutes', '/en/admin/institutes'],
    ['reseller.localhost:4200', '/hi/billing/plans', '/hi/reseller/billing/plans'],
    ['admin.localhost:4200', '/en/admin/dashboard', '/en/admin/dashboard'],
    ['localhost:4200', '/en/institute/dashboard', '/en/institute/dashboard'],
  ])('should serve %s%s from %s', (host, path, target) => {
    expect(served(host, path)).toBe(target);
  });

  it.each([
    ['localhost:4200', '/en/admin/login'],
    ['localhost:4200', '/en/admin/dashboard'],
    ['localhost:4200', '/en/reseller/institutes'],
    ['admin.localhost:4200', '/en/institute/dashboard'],
    ['admin.localhost:4200', '/en/reseller/login'],
    ['reseller.localhost:4200', '/en/admin/observability'],
    ['reseller.localhost:4200', '/hi/institute/people/students'],
    ['app.example.test', '/en/admin/login'],
  ])('should answer %s%s with a page that does not exist', (host, path) => {
    // Under the host's own portal, so the visitor gets that portal's ordinary 404 page.
    expect(served(host, path)).toMatch(
      new RegExp(`^/(en|hi)/${scopeOfHost(host)}/__no-such-page__$`),
    );
  });
});

describe('middleware: content security policy', () => {
  it('should send a policy whose nonce differs on every response', () => {
    const first = visit('localhost:4200', '/en/dashboard').headers.get('content-security-policy');
    const second = visit('localhost:4200', '/en/dashboard').headers.get('content-security-policy');

    const nonce = (policy: string | null) => /'nonce-([^']+)'/.exec(policy ?? '')?.[1];
    expect(nonce(first)).toMatch(/^[A-Za-z0-9+/=]{20,}$/);
    expect(nonce(first)).not.toBe(nonce(second));
    expect(first).toContain("frame-ancestors 'none'");
  });

  it('should hand the same nonce to the page it renders', () => {
    const response = visit('admin.localhost:4200', '/en/dashboard');
    const policy = response.headers.get('content-security-policy') ?? '';

    // How Next.js carries a request header the middleware set.
    expect(response.headers.get('x-middleware-request-x-nonce')).toBe(
      /'nonce-([^']+)'/.exec(policy)?.[1],
    );
    expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(policy);
  });

  it('should send the policy with the page of another portal that does not exist here', () => {
    expect(
      visit('localhost:4200', '/en/admin/login').headers.get('content-security-policy'),
    ).toContain("script-src 'self' 'nonce-");
  });

  it.each([
    '/_next/static/chunk.js',
    '/api/e2e-ready',
    '/favicon.ico',
  ])('should leave %s alone', (path) => {
    const response = visit('localhost:4200', path);
    expect(response.headers.get(REWRITE)).toBeNull();
    expect(response.headers.get('content-security-policy')).toBeNull();
  });
});
