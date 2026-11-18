import type { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { JwtService } from '@nestjs/jwt';
import type { AuthScope, AuthUser } from '@roviq/common-types';

/** The access-token claims the global (APP_GUARD) guards act on. */
export interface RequestTokenClaims {
  scope?: AuthScope;
  resellerId?: string;
  membershipId?: string;
  roleId?: string;
  isImpersonated?: boolean;
  impersonationSessionId?: string;
}

/**
 * Claims of the caller's access token, or `null` for a request without a valid one.
 *
 * `req.user` wins: passport-jwt sets it on HTTP, and the GraphQL context wrapper in
 * `app.module.ts` copies it from the WS connection, which has no Authorization header.
 * An APP_GUARD runs before the per-resolver `GqlAuthGuard`, so on HTTP `req.user` is
 * usually still empty and the Bearer token is verified here instead.
 */
export function readRequestTokenClaims(
  context: ExecutionContext,
  jwtService: JwtService,
  secret: string,
): RequestTokenClaims | null {
  const gqlCtx = GqlExecutionContext.create(context).getContext();
  const req = (gqlCtx?.req ?? context.switchToHttp().getRequest()) as
    | { user?: AuthUser; headers?: Record<string, string | string[] | undefined> }
    | undefined;

  const user = req?.user;
  if (user) {
    return {
      scope: user.scope,
      resellerId: user.scope === 'platform' ? undefined : user.resellerId,
      membershipId: user.membershipId,
      roleId: user.roleId,
      isImpersonated: user.isImpersonated,
      impersonationSessionId: user.impersonationSessionId,
    };
  }

  const header = req?.headers?.authorization;
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw?.toLowerCase().startsWith('bearer ')) return null;
  const token = raw.slice(7).trim();
  if (!token) return null;
  try {
    return jwtService.verify<RequestTokenClaims>(token, { secret });
  } catch {
    return null;
  }
}
