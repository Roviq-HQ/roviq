/**
 * Post-auth redirect targets (the `returnUrl` query param) must be same-origin
 * relative paths. Returns the path when safe, else `null` so callers fall back to
 * their own default. Rejects absolute URLs, protocol-relative `//host`, and the
 * backslash variant `/\host` — both of which browsers resolve to an external
 * origin, enabling open-redirect attacks.
 */
export function sanitizeReturnUrl(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/')) return null;
  const second = raw[1];
  if (second === '/' || second === '\\') return null;
  return raw;
}
