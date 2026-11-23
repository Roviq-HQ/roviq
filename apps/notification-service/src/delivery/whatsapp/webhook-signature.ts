import { createHmac, timingSafeEqual } from 'node:crypto';

const PREFIX = 'sha256=';

/**
 * True when `header` is the HMAC-SHA256 of the exact bytes received, keyed with the app secret.
 * Checked before the body is parsed: an unsigned caller must not reach the JSON parser's output.
 */
export function isSignedByProvider(
  rawBody: Buffer,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!header?.startsWith(PREFIX)) return false;
  const given = Buffer.from(header.slice(PREFIX.length), 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}
