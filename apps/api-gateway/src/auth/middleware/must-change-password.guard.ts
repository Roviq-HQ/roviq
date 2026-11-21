import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { JwtService } from '@nestjs/jwt';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import type { GraphQLResolveInfo } from 'graphql';
import { ALLOW_WHEN_PASSWORD_CHANGE_REQUIRED } from '../decorators/allow-when-password-change-required.decorator';
import { readRequestTokenClaims } from './request-token-claims';

/**
 * First-login enforcement (ROV-96). A caller whose access token carries
 * `mustChangePassword` may call only handlers marked `@AllowWhenPasswordChangeRequired()`.
 *
 * This is an APP_GUARD, so on HTTP it runs before the per-resolver `GqlAuthGuard` has set
 * `req.user`. It therefore reads the token itself; relying on `req.user` let every flagged
 * caller through (SF-041). Requests without a valid token pass: authentication is not this
 * guard's job.
 */
@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const claims = readRequestTokenClaims(
      context,
      this.jwtService,
      this.config.getOrThrow<string>('JWT_SECRET'),
    );
    if (claims?.mustChangePassword !== true) return true;

    // Fields below the root were let in with their root field; they carry no marker of their own.
    if (context.getType<'graphql' | 'http'>() === 'graphql') {
      const info = GqlExecutionContext.create(context).getInfo<GraphQLResolveInfo>();
      if (info.path.prev) return true;
    }

    const isAllowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_WHEN_PASSWORD_CHANGE_REQUIRED,
      [context.getHandler(), context.getClass()],
    );
    if (isAllowed) return true;

    throw new BusinessException(
      ErrorCode.PASSWORD_CHANGE_REQUIRED,
      'You must change your password before continuing.',
    );
  }
}
