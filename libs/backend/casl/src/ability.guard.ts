import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import { AbilityFactory } from './ability.factory';
import { CheckAbility } from './check-ability.decorator';

@Injectable()
export class AbilityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const check = this.reflector.get(CheckAbility, context.getHandler());

    if (!check) {
      return true; // No ability check required
    }

    const ctx = GqlExecutionContext.create(context);
    const user = ctx.getContext().req.user;

    if (!user) {
      throw new BusinessException(ErrorCode.FORBIDDEN, 'Authentication required');
    }

    const ability = await this.abilityFactory.createForUser(user);

    if (!ability.can(check.action, check.subject)) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        `You are not allowed to ${check.action} ${check.subject}`,
      );
    }

    // Attach ability to request for use in resolvers
    ctx.getContext().req.ability = ability;

    return true;
  }
}
