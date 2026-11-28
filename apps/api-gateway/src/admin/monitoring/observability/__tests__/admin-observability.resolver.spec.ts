import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { GqlAuthGuard, PlatformScopeGuard } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import { ErrorCode } from '@roviq/common-types';
import { createMock } from '@roviq/testing';
import { describe, expect, it, vi } from 'vitest';
import { AdminObservabilityResolver } from '../admin-observability.resolver';
import type { ObservabilityService } from '../observability.service';

const reflector = new Reflector();

describe('AdminObservabilityResolver', () => {
  it('should guard the class with auth, platform scope and abilities', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminObservabilityResolver)).toEqual([
      GqlAuthGuard,
      PlatformScopeGuard,
      AbilityGuard,
    ]);
  });

  it.each([
    'adminObservabilityLogs',
    'adminObservabilityTraces',
    'adminObservabilityMetrics',
    'adminObservabilityAlerts',
  ] as const)('should require read:SystemHealth on %s', (handler) => {
    expect(reflector.get(CheckAbility, AdminObservabilityResolver.prototype[handler])).toEqual({
      action: 'read',
      subject: 'SystemHealth',
    });
  });

  it('should default a metrics read to a range query and refuse an unknown endpoint', async () => {
    const service = createMock<ObservabilityService>({
      metrics: vi.fn().mockResolvedValue({ status: 'success' }),
    });
    const resolver = new AdminObservabilityResolver(service);

    await resolver.adminObservabilityMetrics('up');
    expect(service.metrics).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'query_range', query: 'up' }),
    );

    expect(() => resolver.adminObservabilityMetrics('up', 'series')).toThrow(
      expect.objectContaining({ code: ErrorCode.VALIDATION_FAILED }),
    );
  });
});
