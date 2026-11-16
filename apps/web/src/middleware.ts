import { routing } from '@roviq/i18n';
import { type NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';

const SCOPE_MAP: Record<string, string> = {
  admin: 'admin',
  reseller: 'reseller',
};

function getScopeFromHostname(hostname: string): string {
  const subdomain = hostname.split('.')[0].split(':')[0]; // strip port
  return SCOPE_MAP[subdomain] ?? 'institute';
}

const intlMiddleware = createMiddleware(routing);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip static files and API routes
  if (pathname.startsWith('/_next') || pathname.startsWith('/api') || pathname.includes('.')) {
    return NextResponse.next();
  }

  const intlResponse = intlMiddleware(request);
  if (!intlResponse.ok) return intlResponse;

  const hostname = request.headers.get('host') ?? '';
  const scope = getScopeFromHostname(hostname);

  const [, locale, ...segments] = pathname.split('/');
  const restPath = `/${segments.join('/')}`;

  // Check if path already starts with a scope prefix
  const scopePrefixes = ['admin', 'reseller', 'institute'];
  const pathAfterLocale = restPath;
  const hasScope = scopePrefixes.some(
    (s) => pathAfterLocale.startsWith(`/${s}/`) || pathAfterLocale === `/${s}`,
  );

  // If no scope prefix, rewrite to add it based on hostname
  if (!hasScope) {
    // Root path or bare locale → redirect to scope's login page
    const isRoot = restPath === '/' || restPath === '';
    const targetPath = isRoot ? '/login' : restPath;

    const newPath = `/${locale}/${scope}${targetPath}`;

    const url = request.nextUrl.clone();
    url.pathname = newPath;
    return NextResponse.rewrite(url, { headers: intlResponse.headers });
  }

  return intlResponse;
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
