import { routing } from '@roviq/i18n';
import { NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import {
  buildContentSecurityPolicy,
  policyOriginsFromEnv,
} from './security/content-security-policy';

const SCOPES = ['admin', 'reseller', 'institute'] as const;
type Scope = (typeof SCOPES)[number];

/** The portal a host serves: `admin.` and `reseller.` their own, every other host the institute's. */
export function scopeOfHost(host: string): Scope {
  const subdomain = host.split('.')[0]?.split(':')[0] ?? '';
  return subdomain === 'admin' || subdomain === 'reseller' ? subdomain : 'institute';
}

/** The portal a path names after its locale (`/en/admin/…`), or null when it names none. */
export function scopeOfPath(pathAfterLocale: string): Scope | null {
  return (
    SCOPES.find((s) => pathAfterLocale === `/${s}` || pathAfterLocale.startsWith(`/${s}/`)) ?? null
  );
}

const intlMiddleware = createMiddleware(routing);

const POLICY_ORIGINS = policyOriginsFromEnv({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
  S3_PUBLIC_ENDPOINT: process.env.S3_PUBLIC_ENDPOINT,
  S3_PUBLIC_BASE_URL: process.env.S3_PUBLIC_BASE_URL,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});

const POLICY_HEADER = 'Content-Security-Policy';
const NONCE_HEADER = 'x-nonce';
/** How Next.js carries a request header that a middleware set, on the middleware's response. */
const REQUEST_HEADER_PREFIX = 'x-middleware-request-';

/** A segment no page has: under the host's own portal the app answers it with its 404 page. */
const NO_SUCH_PAGE = '__no-such-page__';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip static files and API routes
  if (pathname.startsWith('/_next') || pathname.startsWith('/api') || pathname.includes('.')) {
    return NextResponse.next();
  }

  // Next.js reads the nonce from the policy on the request and puts it on its own scripts;
  // the layouts read `x-nonce` for the one inline script that is ours (the theme).
  const nonce = btoa(crypto.randomUUID());
  const policy = buildContentSecurityPolicy({
    nonce,
    development: process.env.NODE_ENV === 'development',
    ...POLICY_ORIGINS,
  });
  const headers = new Headers(request.headers);
  headers.set(NONCE_HEADER, nonce);
  headers.set(POLICY_HEADER, policy);
  const withPolicy = (response: NextResponse): NextResponse => {
    response.headers.set(POLICY_HEADER, policy);
    return response;
  };
  const rewriteTo = (path: string, from: NextResponse): NextResponse => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    // Request headers next-intl set for the page (the resolved locale) travel with ours.
    for (const [name, value] of from.headers) {
      if (name.startsWith(REQUEST_HEADER_PREFIX)) {
        headers.set(name.slice(REQUEST_HEADER_PREFIX.length), value);
      }
    }
    const response = NextResponse.rewrite(url, { request: { headers } });
    // The locale cookie and the alternate links next-intl decided on.
    for (const [name, value] of from.headers) {
      if (!name.startsWith('x-middleware-')) response.headers.append(name, value);
    }
    return withPolicy(response);
  };

  const intlResponse = intlMiddleware(new NextRequest(request, { headers }));
  if (!intlResponse.ok) return intlResponse;

  const hostScope = scopeOfHost(request.headers.get('host') ?? '');
  const [, locale, ...segments] = pathname.split('/');
  const restPath = `/${segments.join('/')}`;
  const pathScope = scopeOfPath(restPath);

  // Each host serves one portal: another portal's pages do not exist here.
  if (pathScope !== null && pathScope !== hostScope) {
    return rewriteTo(`/${locale}/${hostScope}/${NO_SUCH_PAGE}`, intlResponse);
  }

  // No portal in the path: add the host's own.
  if (pathScope === null) {
    // Root path or bare locale → the portal's login page
    const isRoot = restPath === '/' || restPath === '';
    return rewriteTo(`/${locale}/${hostScope}${isRoot ? '/login' : restPath}`, intlResponse);
  }

  return withPolicy(intlResponse);
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
