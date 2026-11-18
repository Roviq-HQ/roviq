const PORTAL_SUBDOMAINS = new Set(['admin', 'reseller']);

/**
 * Origin of the institute portal, seen from the admin or reseller portal.
 *
 * `NEXT_PUBLIC_INSTITUTE_URL` wins when set (production: the institute portal is its own
 * host, app.roviq.com). Otherwise the admin./reseller. label is dropped from the current
 * host, which matches local hosts such as admin.localhost:4260 → localhost:4260.
 */
export function institutePortalOrigin(
  location: Pick<Location, 'protocol' | 'host'>,
  configured: string | undefined = process.env.NEXT_PUBLIC_INSTITUTE_URL,
): string {
  if (configured) return configured.replace(/\/+$/, '');
  const [first, ...rest] = location.host.split('.');
  const host = PORTAL_SUBDOMAINS.has(first) && rest.length > 0 ? rest.join('.') : location.host;
  return `${location.protocol}//${host}`;
}

/** URL of the page in the institute portal that trades a one-time code for a session. */
export function impersonationExchangeUrl(origin: string, locale: string, code: string): string {
  return `${origin}/${locale}/auth/impersonate?code=${encodeURIComponent(code)}`;
}
