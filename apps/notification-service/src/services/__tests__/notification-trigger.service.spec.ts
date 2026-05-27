import type { ConfigService } from '@nestjs/config';
import type { TriggerPayload } from '@roviq/notifications';
import { clearAllCircuitBreakers } from '@roviq/resilience';
import { createMock } from '@roviq/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockTrigger = vi.fn();
const mockNovuInstance = { trigger: mockTrigger };

vi.mock('@roviq/notifications', async (importOriginal) => {
  const original = await importOriginal<typeof import('@roviq/notifications')>();
  return { ...original, createNovuClient: vi.fn(() => mockNovuInstance) };
});

import { NotificationTriggerService } from '../notification-trigger.service';

function makeConfigService() {
  return createMock<ConfigService>({
    get: vi.fn().mockReturnValue('cloud'),
    getOrThrow: vi.fn().mockReturnValue('novu-secret'),
  });
}

function makePayload(overrides: Partial<TriggerPayload> = {}): TriggerPayload {
  return {
    workflowId: 'system-auth',
    to: { subscriberId: 'user-1', email: 'r@example.com', phone: '+911234567890' },
    payload: { code: '123456' },
    tenantId: 'tenant-1',
    ...overrides,
  };
}

describe('NotificationTriggerService', () => {
  let service: NotificationTriggerService;

  // Breaker state is keyed by name in a module-level registry; clear so the
  // 'novu-trigger' breaker never leaks between tests.
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllCircuitBreakers();
    service = new NotificationTriggerService(makeConfigService());
  });

  afterEach(() => {
    clearAllCircuitBreakers();
  });

  it('triggers the Novu workflow on the happy path', async () => {
    mockTrigger.mockResolvedValue(undefined);

    await service.trigger(makePayload());

    expect(mockTrigger).toHaveBeenCalledOnce();
    expect(mockTrigger).toHaveBeenCalledWith({
      workflowId: 'system-auth',
      to: { subscriberId: 'user-1', email: 'r@example.com', phone: '+911234567890' },
      payload: { code: '123456' },
      context: { tenant: { id: 'tenant-1' } },
    });
  });

  it('rejects (fast-fails) once the circuit opens after repeated Novu failures', async () => {
    mockTrigger.mockRejectedValue(new Error('Novu down'));

    // Drive enough failures past the 50% error threshold to trip the breaker.
    for (let i = 0; i < 10; i++) {
      await expect(service.trigger(makePayload())).rejects.toThrow();
    }

    const callsBeforeOpen = mockTrigger.mock.calls.length;

    // Circuit is now open — fire once more and assert it rejects without
    // reaching the underlying Novu client (fast-fail via fallback).
    await expect(service.trigger(makePayload())).rejects.toThrow();
    expect(mockTrigger.mock.calls.length).toBe(callsBeforeOpen);
  });
});
