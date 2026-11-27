import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { type AppAbility, BusinessException, ErrorCode } from '@roviq/common-types';
import { AbilityFactory } from './ability.factory';
import { type AbilityCheck, CheckAbility } from './check-ability.decorator';

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

    if (check.rows !== 'scoped' && !allowsEveryRow(ability, check)) {
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

/**
 * True when the caller holds the pair for every row: a rule without a condition allows it and
 * no rule with a condition takes rows away. Only then may an operation that does not apply row
 * conditions serve the caller.
 */
function allowsEveryRow(ability: AppAbility, check: AbilityCheck): boolean {
  const rules = ability.rulesFor(check.action, check.subject);
  const grantsAll = rules.some((rule) => !rule.inverted && !rule.conditions);
  const takesRows = rules.some((rule) => rule.inverted && rule.conditions);
  return grantsAll && !takesRows;
}
