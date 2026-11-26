import { Reflector } from '@nestjs/core';
import type { AppAction, AppSubject } from '@roviq/common-types';

export interface AbilityCheck {
  action: AppAction;
  subject: AppSubject;
  /**
   * `'scoped'` declares that the operation applies the caller's row conditions itself: a SQL
   * predicate from `caslToSqlWhere`, `ability.can()` on the loaded row, or ids taken only from
   * the token. Without it, the guard refuses a caller whose rule on the pair carries a condition.
   */
  rows?: 'scoped';
}

export const CheckAbility = Reflector.createDecorator<AbilityCheck>();
