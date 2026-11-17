import { createMongoAbility } from '@casl/ability';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type AppAbility, BusinessException, ErrorCode } from '@roviq/common-types';
import { createMock } from '@roviq/testing';
import { describe, expect, it, vi } from 'vitest';
import type { AbilityFactory } from '../ability.factory';
import { AbilityGuard } from '../ability.guard';
import { CheckAbility } from '../check-ability.decorator';

class FixtureResolver {
  @CheckAbility({ action: 'create', subject: 'Attendance' })
  guarded() {}

  unguarded() {}
}

interface FixtureRequest {
  user?: { userId: string };
  ability?: AppAbility;
}

function buildContext(handler: () => void, req: FixtureRequest): ExecutionContext {
  return createMock<ExecutionContext>({
    getHandler: () => handler,
    getClass: () => FixtureResolver,
    getArgs: () => [undefined, {}, { req }, undefined],
    getType: () => 'graphql',
  });
}

function buildGuard(ability: AppAbility) {
  const createForUser = vi.fn().mockResolvedValue(ability);
  const guard = new AbilityGuard(new Reflector(), createMock<AbilityFactory>({ createForUser }));
  return { guard, createForUser };
}

const resolver = new FixtureResolver();

describe('AbilityGuard', () => {
  it('should allow a handler without @CheckAbility and skip the ability lookup', async () => {
    const { guard, createForUser } = buildGuard(createMongoAbility<AppAbility>([]));

    const allowed = await guard.canActivate(buildContext(resolver.unguarded, {}));

    expect(allowed).toBe(true);
    expect(createForUser).not.toHaveBeenCalled();
  });

  it('should allow and attach the ability when the user can perform the checked pair', async () => {
    const ability = createMongoAbility<AppAbility>([{ action: 'create', subject: 'Attendance' }]);
    const { guard } = buildGuard(ability);
    const req: FixtureRequest = { user: { userId: 'user-1' } };

    const allowed = await guard.canActivate(buildContext(resolver.guarded, req));

    expect(allowed).toBe(true);
    expect(req.ability).toBe(ability);
  });

  it('should reject when the user lacks the checked pair', async () => {
    const ability = createMongoAbility<AppAbility>([{ action: 'read', subject: 'Attendance' }]);
    const { guard } = buildGuard(ability);

    await expect(
      guard.canActivate(buildContext(resolver.guarded, { user: { userId: 'user-1' } })),
    ).rejects.toThrow(
      new BusinessException(ErrorCode.FORBIDDEN, 'You are not allowed to create Attendance'),
    );
  });

  it('should reject a guarded handler when the request has no user', async () => {
    const { guard } = buildGuard(createMongoAbility<AppAbility>([]));

    await expect(guard.canActivate(buildContext(resolver.guarded, {}))).rejects.toThrow(
      new BusinessException(ErrorCode.FORBIDDEN, 'Authentication required'),
    );
  });
});
