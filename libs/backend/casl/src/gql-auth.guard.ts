import { type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AuthGuard } from '@nestjs/passport';
import type { AuthUser } from '@roviq/common-types';

@Injectable()
export class GqlAuthGuard extends AuthGuard('jwt') {
  override getRequest(context: ExecutionContext) {
    const ctx = GqlExecutionContext.create(context);
    return ctx.getContext().req;
  }

  // biome-ignore lint/suspicious/noExplicitAny: must match IAuthGuard.handleRequest signature
  override handleRequest<TUser = any>(err: any, user: any, _info: any): TUser {
    if (err || !user) {
      throw err || new UnauthorizedException();
    }
    const authUser = user as AuthUser;
    // Platform admins use platform tokens as their access tokens
    if (authUser.type !== 'access' && !(authUser.type === 'platform' && authUser.isPlatformAdmin)) {
      throw new UnauthorizedException('Access token required');
    }
    return user as TUser;
  }
}
