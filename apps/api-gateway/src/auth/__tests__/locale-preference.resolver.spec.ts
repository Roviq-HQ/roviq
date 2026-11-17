import type { AuthScope, AuthUser } from '@roviq/common-types';
import { ErrorCode } from '@roviq/common-types';
import { createMock } from '@roviq/testing';
import { describe, expect, it, vi } from 'vitest';
import { AuthResolver } from '../auth.resolver';
import { AuthService } from '../auth.service';

const scopes: AuthScope[] = ['platform', 'reseller', 'institute'];

describe('account language ownership', () => {
  it.each(scopes)('should read and save only the authenticated %s account', async (scope) => {
    const service = createMock<AuthService>({
      getPreferredLocale: vi.fn().mockResolvedValue('hi'),
      updatePreferredLocale: vi.fn().mockResolvedValue('en'),
    });
    const resolver = new AuthResolver(service);
    const actor = createMock<AuthUser>({
      userId: 'authenticated-user',
      scope,
      isImpersonated: false,
    });

    expect(await resolver.myPreferredLocale(actor)).toBe('hi');
    expect(await resolver.updateMyPreferredLocale({ locale: 'en' }, actor)).toBe('en');
    expect(service.getPreferredLocale).toHaveBeenCalledWith('authenticated-user');
    expect(service.updatePreferredLocale).toHaveBeenCalledWith('authenticated-user', 'en');
  });

  it('should refuse preference writes while impersonating', async () => {
    const service = createMock<AuthService>();
    const resolver = new AuthResolver(service);
    const actor = createMock<AuthUser>({
      userId: 'target-user',
      scope: 'institute',
      isImpersonated: true,
    });

    await expect(resolver.updateMyPreferredLocale({ locale: 'hi' }, actor)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
    expect(service.updatePreferredLocale).not.toHaveBeenCalled();
  });
});
