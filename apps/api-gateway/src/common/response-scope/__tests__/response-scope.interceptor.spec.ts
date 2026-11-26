import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AuthUser } from '@roviq/common-types';
import { ErrorCode } from '@roviq/common-types';
import { createMock } from '@roviq/testing';
import { lastValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ResponseScopeInterceptor } from '../response-scope.interceptor';
import { ResponseScopeGauge } from '../response-scope-gauge';

vi.mock('../response-scope.allowlist', () => ({
  FOREIGN_SCOPE_ALLOWED: { listedOperation: 'a reason' },
}));

const OWN = '019b0000-0000-7000-8000-0000000000aa';
const OTHER = '019b0000-0000-7000-8000-0000000000bb';

const institute = createMock<AuthUser>({ scope: 'institute', tenantId: OWN });
const reseller = createMock<AuthUser>({ scope: 'reseller', resellerId: OWN });
const platform = createMock<AuthUser>({ scope: 'platform' });

function run(options: {
  mode?: string;
  user?: AuthUser;
  value: unknown;
  parent?: string;
  operation?: string;
}) {
  const gauge = new ResponseScopeGauge();
  const config = createMock<ConfigService>({ get: vi.fn(() => options.mode) });
  const interceptor = new ResponseScopeInterceptor(config, gauge);
  const info = {
    parentType: { name: options.parent ?? 'Query' },
    fieldName: options.operation ?? 'someOperation',
  };
  const context = createMock<ExecutionContext>({
    getType: () => 'graphql',
    getArgs: () => [{}, {}, { req: { user: options.user } }, info],
  });
  const next = createMock<CallHandler>({ handle: () => of(options.value) });
  const count = () => gauge.readings().reduce((sum, reading) => sum + reading.count, 0);
  return { result: lastValueFrom(interceptor.intercept(context, next)), count };
}

describe('ResponseScopeInterceptor', () => {
  it("should pass a result of the caller's own institute", async () => {
    const value = [{ tenantId: OWN }];
    const { result, count } = run({ user: institute, value });
    await expect(result).resolves.toBe(value);
    expect(count()).toBe(0);
  });

  it('should refuse and count a result of another institute when no mode is set', async () => {
    const { result, count } = run({ user: institute, value: [{ tenantId: OTHER }] });
    await expect(result).rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR });
    expect(count()).toBe(1);
  });

  it('should refuse a reseller a result of another reseller', async () => {
    const { result } = run({ user: reseller, value: { resellerId: OTHER } });
    await expect(result).rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR });
  });

  it('should count and still send in report mode', async () => {
    const value = [{ tenantId: OTHER }];
    const { result, count } = run({ mode: 'report', user: institute, value });
    await expect(result).resolves.toBe(value);
    expect(count()).toBe(1);
  });

  it('should do nothing when switched off', async () => {
    const value = [{ tenantId: OTHER }];
    const { result, count } = run({ mode: 'off', user: institute, value });
    await expect(result).resolves.toBe(value);
    expect(count()).toBe(0);
  });

  it('should not check a platform caller or a request with no caller', async () => {
    const value = [{ tenantId: OTHER, resellerId: OTHER }];
    await expect(run({ user: platform, value }).result).resolves.toBe(value);
    await expect(run({ value }).result).resolves.toBe(value);
  });

  it('should not check a subscription or a field of another type', async () => {
    const value = [{ tenantId: OTHER }];
    await expect(run({ user: institute, value, parent: 'Subscription' }).result).resolves.toBe(
      value,
    );
    await expect(run({ user: institute, value, parent: 'StudentModel' }).result).resolves.toBe(
      value,
    );
  });

  it('should not check an operation on the allowed list', async () => {
    const value = [{ tenantId: OTHER }];
    const { result, count } = run({ user: institute, value, operation: 'listedOperation' });
    await expect(result).resolves.toBe(value);
    expect(count()).toBe(0);
  });
});
