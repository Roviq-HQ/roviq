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

  @CheckAbility({ action: 'read', subject: 'Leave' })
  readsEveryRow() {}

  @CheckAbility({ action: 'read', subject: 'Leave', rows: 'scoped' })
  readsScopedRows() {}

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

  describe('row conditions', () => {
    const user = { userId: 'user-1' };
    const refusal = new BusinessException(ErrorCode.FORBIDDEN, 'You are not allowed to read Leave');
    const own = {
      action: 'read',
      subject: 'Leave',
      conditions: { userId: 'membership-1' },
    } as const;

    it('should refuse a caller whose only rule has a condition on an operation that declares no row scoping', async () => {
      const { guard } = buildGuard(createMongoAbility<AppAbility>([own]));

      await expect(
        guard.canActivate(buildContext(resolver.readsEveryRow, { user })),
      ).rejects.toThrow(refusal);
    });

    it('should allow that caller on an operation that declares row scoping', async () => {
      const ability = createMongoAbility<AppAbility>([own]);
      const { guard } = buildGuard(ability);
      const req: FixtureRequest = { user };

      expect(await guard.canActivate(buildContext(resolver.readsScopedRows, req))).toBe(true);
      expect(req.ability).toBe(ability);
    });

    it('should allow a caller with an unconditional rule on an operation that declares no row scoping', async () => {
      const { guard } = buildGuard(
        createMongoAbility<AppAbility>([{ action: 'read', subject: 'Leave' }]),
      );

      expect(await guard.canActivate(buildContext(resolver.readsEveryRow, { user }))).toBe(true);
    });

    it('should allow a caller who holds the pair both with and without a condition', async () => {
      const { guard } = buildGuard(
        createMongoAbility<AppAbility>([own, { action: 'manage', subject: 'Leave' }]),
      );

      expect(await guard.canActivate(buildContext(resolver.readsEveryRow, { user }))).toBe(true);
    });

    it('should allow a caller whose unconditional rule is limited to fields only', async () => {
      const { guard } = buildGuard(
        createMongoAbility<AppAbility>([
          { action: 'read', subject: 'Leave' },
          { action: 'read', subject: 'Leave', fields: ['reason'], inverted: true },
        ]),
      );

      expect(await guard.canActivate(buildContext(resolver.readsEveryRow, { user }))).toBe(true);
    });

    it('should refuse a caller whose unconditional rule is narrowed by a conditional cannot rule', async () => {
      const { guard } = buildGuard(
        createMongoAbility<AppAbility>([
          { action: 'read', subject: 'Leave' },
          { action: 'read', subject: 'Leave', inverted: true, conditions: { status: 'PENDING' } },
        ]),
      );

      await expect(
        guard.canActivate(buildContext(resolver.readsEveryRow, { user })),
      ).rejects.toThrow(refusal);
    });

    it('should refuse a caller whose manage-all rule has a condition', async () => {
      const { guard } = buildGuard(
        createMongoAbility<AppAbility>([
          { action: 'manage', subject: 'all', conditions: { tenantId: 'tenant-1' } },
        ]),
      );

      await expect(
        guard.canActivate(buildContext(resolver.readsEveryRow, { user })),
      ).rejects.toThrow(refusal);
    });
  });
});
