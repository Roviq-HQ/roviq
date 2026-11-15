import { createParamDecorator, type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { AppAbility, AuthUser, InstituteContext } from '@roviq/common-types';

export interface InstituteReadAccess {
  user: InstituteContext;
  ability: AppAbility;
}

export interface AbilityRequestContext {
  req: { user: AuthUser; ability?: AppAbility };
}

export const CurrentReadAccess = createParamDecorator(
  (_data: unknown, execution: ExecutionContext): InstituteReadAccess => {
    const { req } = GqlExecutionContext.create(execution).getContext<AbilityRequestContext>();
    if (req.user.scope !== 'institute' || !req.ability) {
      throw new ForbiddenException('Institute read authorization is required');
    }
    return { user: req.user, ability: req.ability };
  },
);
