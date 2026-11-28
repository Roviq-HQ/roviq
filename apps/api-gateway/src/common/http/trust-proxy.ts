import type { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Tells Express how many reverse proxies stand in front of the API (`TRUST_PROXY_HOPS`), so
 * that `req.ip` is the client's address and not the proxy's.
 *
 * A count, never `true`: with `true` Express believes the leftmost `X-Forwarded-For` entry,
 * which the client writes itself. With a count of n it takes the address n hops from the
 * right, which is the one the outermost trusted proxy saw. Unset or 0 leaves the socket's own
 * address, which is right when nothing stands in front (local development).
 */
export function applyTrustProxy(
  app: Pick<NestExpressApplication, 'set'>,
  config: Pick<ConfigService, 'get'>,
): number {
  const hops = Number(config.get('TRUST_PROXY_HOPS') ?? 0);
  if (hops > 0) app.set('trust proxy', hops);
  return hops;
}
