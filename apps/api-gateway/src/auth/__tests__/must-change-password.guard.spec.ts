/**
 * MustChangePasswordGuard unit tests. The guard is an APP_GUARD, so on HTTP it runs before
 * GqlAuthGuard sets `req.user` and reads the Bearer token itself; on a subscription the
 * context wrapper has already put the user on `req.user`. The full pipeline (real login,
 * real token) is covered by must-change-password.integration.spec.ts.
 */
import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { JwtService } from '@nestjs/jwt';
import { type AuthUser, ErrorCode } from '@roviq/common-types';
import { createMock } from '@roviq/testing';
import type { GraphQLResolveInfo } from 'graphql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectBusinessError } from '../../__tests__/expect-business-error';
import { ALLOW_WHEN_PASSWORD_CHANGE_REQUIRED } from '../decorators/allow-when-password-change-required.decorator';
import { MustChangePasswordGuard } from '../middleware/must-change-password.guard';

vi.mock('@nestjs/graphql', () => ({
  GqlExecutionContext: { create: vi.fn() },
}));

const SECRET = 'must-change-password-guard-test-secret';
// A real JwtService signs and verifies, so the Bearer path checks a genuine token.
const jwt = new JwtService();

function accessToken(claims: { mustChangePassword?: boolean }, secret = SECRET): string {
  return jwt.sign(
    {
      sub: 'user-1',
      scope: 'institute',
      tenantId: 'tenant-1',
      membershipId: 'membership-1',
      roleId: 'role-1',
      type: 'access',
      ...claims,
    },
    { secret, expiresIn: 300 },
  );
}

function instituteUser(mustChangePassword: boolean): AuthUser {
  return {
    _scope: 'institute',
    scope: 'institute',
    userId: 'user-1',
    tenantId: 'tenant-1',
    membershipId: 'membership-1',
    roleId: 'role-1',
    type: 'access',
    mustChangePassword,
  };
}

/** A root field when `nested` is false: its path has no `prev`. */
function resolveInfo(nested: boolean): GraphQLResolveInfo {
  const root = { prev: undefined, key: 'students', typename: 'Query' };
  return createMock<GraphQLResolveInfo>({
    path: nested ? { prev: root, key: 'firstName', typename: 'StudentModel' } : root,
  });
}

interface RequestStub {
  user?: AuthUser;
  headers?: Record<string, string | string[] | undefined>;
}

function stubGraphql(req: RequestStub | undefined, nested = false): void {
  vi.mocked(GqlExecutionContext.create).mockReturnValue(
    createMock<GqlExecutionContext>({
      getContext: () => (req === undefined ? {} : { req }),
      getInfo: () => resolveInfo(nested),
    }),
  );
}

const handler = () => undefined;
class SomeResolver {}

function executionContext(): ExecutionContext {
  return createMock<ExecutionContext>({
    getType: vi.fn().mockReturnValue('graphql'),
    getHandler: vi.fn().mockReturnValue(handler),
    getClass: vi.fn().mockReturnValue(SomeResolver),
    switchToHttp: vi.fn().mockReturnValue({ getRequest: () => undefined }),
  });
}

function createGuard(allowed: boolean | undefined) {
  const reflector = createMock<Reflector>({
    getAllAndOverride: vi.fn().mockReturnValue(allowed),
  });
  const config = createMock<ConfigService>({ getOrThrow: vi.fn(() => SECRET) });
  return { guard: new MustChangePasswordGuard(reflector, jwt, config), reflector };
}

const bearer = (token: string): RequestStub => ({
  headers: { authorization: `Bearer ${token}` },
});

describe('MustChangePasswordGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Bearer token (HTTP, before GqlAuthGuard runs)', () => {
    it('should refuse a flagged token on a root field without the marker', async () => {
      stubGraphql(bearer(accessToken({ mustChangePassword: true })));
      const { guard, reflector } = createGuard(undefined);

      await expectBusinessError(
        () => guard.canActivate(executionContext()),
        ErrorCode.PASSWORD_CHANGE_REQUIRED,
      );
      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
        ALLOW_WHEN_PASSWORD_CHANGE_REQUIRED,
        [handler, SomeResolver],
      );
    });

    it('should let a flagged token through to a marked handler', () => {
      stubGraphql(bearer(accessToken({ mustChangePassword: true })));
      const { guard } = createGuard(true);

      expect(guard.canActivate(executionContext())).toBe(true);
    });

    it('should let a flagged token through on a nested field without reading the marker', () => {
      stubGraphql(bearer(accessToken({ mustChangePassword: true })), true);
      const { guard, reflector } = createGuard(undefined);

      expect(guard.canActivate(executionContext())).toBe(true);
      expect(reflector.getAllAndOverride).not.toHaveBeenCalled();
    });

    it.each([
      ['a token without the flag', () => accessToken({})],
      ['a token with the flag false', () => accessToken({ mustChangePassword: false })],
    ])('should let %s through without reading the marker', (_name, token) => {
      stubGraphql(bearer(token()));
      const { guard, reflector } = createGuard(undefined);

      expect(guard.canActivate(executionContext())).toBe(true);
      expect(reflector.getAllAndOverride).not.toHaveBeenCalled();
    });
  });

  describe('req.user (WebSocket, set by the context wrapper)', () => {
    it('should refuse a flagged user on a root field without the marker', async () => {
      stubGraphql({ user: instituteUser(true) });
      const { guard } = createGuard(undefined);

      await expectBusinessError(
        () => guard.canActivate(executionContext()),
        ErrorCode.PASSWORD_CHANGE_REQUIRED,
      );
    });

    it('should let an unflagged user through', () => {
      stubGraphql({ user: instituteUser(false) });
      const { guard } = createGuard(undefined);

      expect(guard.canActivate(executionContext())).toBe(true);
    });
  });

  describe('no usable token (authentication is not this guard’s job)', () => {
    it.each<[string, RequestStub | undefined]>([
      ['no request', undefined],
      ['no Authorization header', { headers: {} }],
      ['a non-Bearer header', { headers: { authorization: 'Basic abc' } }],
      ['an empty Bearer token', { headers: { authorization: 'Bearer   ' } }],
      [
        'a flagged token signed with another secret',
        bearer(accessToken({ mustChangePassword: true }, 'another-secret')),
      ],
      ['a malformed token', bearer('not.a.jwt')],
    ])('should let %s through', (_name, req) => {
      stubGraphql(req);
      const { guard } = createGuard(undefined);

      expect(guard.canActivate(executionContext())).toBe(true);
    });
  });
});
