import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { GqlAuthGuard, PlatformScopeGuard } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import { createMock } from '@roviq/testing';
import { describe, expect, it, vi } from 'vitest';
import { AdminSystemHealthResolver } from '../admin-system-health.resolver';
import type { SystemHealthService } from '../system-health.service';

const reflector = new Reflector();

describe('AdminSystemHealthResolver', () => {
  it('should guard the class with auth, platform scope and abilities', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminSystemHealthResolver)).toEqual([
      GqlAuthGuard,
      PlatformScopeGuard,
      AbilityGuard,
    ]);
  });

  it.each([
    'adminSystemHealth',
    'adminConnectionMetrics',
    'adminSystemHealthUpdated',
  ] as const)('should require read:SystemHealth on %s', (handler) => {
    expect(reflector.get(CheckAbility, AdminSystemHealthResolver.prototype[handler])).toEqual({
      action: 'read',
      subject: 'SystemHealth',
    });
  });

  it('should delegate connection metrics to the service', () => {
    const service = createMock<SystemHealthService>({
      getConnectionStats: vi.fn().mockReturnValue({ websocket: 2, http: 3 }),
    });

    expect(new AdminSystemHealthResolver(service).adminConnectionMetrics()).toEqual({
      websocket: 2,
      http: 3,
    });
  });
});
