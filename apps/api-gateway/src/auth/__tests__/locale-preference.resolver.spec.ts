import type { AuthScope, AuthUser } from '@roviq/common-types';
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
    expect(service.getPreferredLocale).toHaveBeenCalledWith(actor);
    expect(service.updatePreferredLocale).toHaveBeenCalledWith(actor, 'en');
  });
});
