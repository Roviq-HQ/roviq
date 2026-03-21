import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  mixin,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { AuthScope, AuthUser } from '@roviq/common-types';

export function createScopeGuard(scope: AuthScope) {
  @Injectable()
  class ScopeGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const ctx = GqlExecutionContext.create(context);
      const user = ctx.getContext().req.user as AuthUser | undefined;
      if (!user || user.scope !== scope) {
        throw new ForbiddenException(`${scope} scope required`);
      }
      return true;
    }
  }
  return mixin(ScopeGuard);
}

export const PlatformScopeGuard = createScopeGuard('platform');
export const ResellerScopeGuard = createScopeGuard('reseller');
export const InstituteScopeGuard = createScopeGuard('institute');
