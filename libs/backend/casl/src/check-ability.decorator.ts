import { Reflector } from '@nestjs/core';
import type { AppAction, AppSubject } from '@roviq/common-types';

export interface AbilityCheck {
  action: AppAction;
  subject: AppSubject;
}

export const CheckAbility = Reflector.createDecorator<AbilityCheck>();
