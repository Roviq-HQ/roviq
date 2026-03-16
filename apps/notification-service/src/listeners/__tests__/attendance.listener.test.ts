import type { AttendanceAbsentEvent } from '@roviq/notifications';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @roviq/nats-utils before importing the listener
vi.mock('@roviq/nats-utils', () => ({
  subscribe: vi.fn(),
}));

import { AttendanceListener } from '../attendance.listener';

type Handler = (payload: AttendanceAbsentEvent, meta: object) => Promise<void>;

function makeEvent(overrides: Partial<AttendanceAbsentEvent> = {}): AttendanceAbsentEvent {
  return {
    tenantId: 'tenant-abc',
    studentId: 'student-123',
    studentName: 'Riya Sharma',
    sectionId: 'section-1',
    sectionName: '10-A',
    date: '2026-03-07',
    markedBy: 'teacher-99',
    ...overrides,
  };
}

async function captureHandler(listener: AttendanceListener): Promise<Handler> {
  const { subscribe } = await import('@roviq/nats-utils');
  const subscribeMock = subscribe as ReturnType<typeof vi.fn>;

  let capturedHandler: Handler | null = null;
  subscribeMock.mockImplementation((_nc: unknown, _opts: unknown, handler: Handler) => {
    capturedHandler = handler;
  });

  await listener.onModuleInit();
  if (!capturedHandler) throw new Error('subscribe was not called');
  return capturedHandler;
}

describe('AttendanceListener', () => {
  let listener: AttendanceListener;
  let mockTriggerService: { trigger: ReturnType<typeof vi.fn> };
  let mockPreferenceLoader: { loadConfig: ReturnType<typeof vi.fn> };
  let mockNc: object;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTriggerService = { trigger: vi.fn().mockResolvedValue(undefined) };
    mockPreferenceLoader = {
      loadConfig: vi.fn().mockResolvedValue({
        inApp: true,
        whatsapp: false,
        email: true,
        push: false,
        digest: false,
        digestCron: undefined,
      }),
    };
    mockNc = {};

    listener = new AttendanceListener(
      mockNc as never,
      mockTriggerService as never,
      mockPreferenceLoader as never,
    );
  });

  describe('handleAbsent (via onModuleInit callback)', () => {
    it('calls triggerService.trigger with workflowId "attendance-absent"', async () => {
      const handler = await captureHandler(listener);
      await handler(makeEvent(), {});

      expect(mockTriggerService.trigger).toHaveBeenCalledOnce();
      expect(mockTriggerService.trigger).toHaveBeenCalledWith(
        expect.objectContaining({ workflowId: 'attendance-absent' }),
      );
    });

    it('passes channel config from preferenceLoader through to trigger payload', async () => {
      const channelConfig = {
        inApp: false,
        whatsapp: true,
        email: false,
        push: true,
        digest: true,
        digestCron: '0 9 * * *',
      };
      mockPreferenceLoader.loadConfig.mockResolvedValueOnce(channelConfig);

      const handler = await captureHandler(listener);
      await handler(makeEvent(), {});

      expect(mockTriggerService.trigger).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            config: {
              inApp: false,
              whatsapp: true,
              email: false,
              push: true,
            },
            digestCron: '0 9 * * *',
          }),
        }),
      );
    });

    it('uses the plain studentId as subscriberId (no tenant prefix)', async () => {
      const handler = await captureHandler(listener);
      await handler(makeEvent({ studentId: 'student-xyz' }), {});

      expect(mockTriggerService.trigger).toHaveBeenCalledWith(
        expect.objectContaining({
          to: { subscriberId: 'student-xyz' },
        }),
      );
    });

    it('calls preferenceLoader.loadConfig with tenantId and "ATTENDANCE" type', async () => {
      const handler = await captureHandler(listener);
      await handler(makeEvent({ tenantId: 'tenant-42' }), {});

      expect(mockPreferenceLoader.loadConfig).toHaveBeenCalledWith('tenant-42', 'ATTENDANCE');
    });

    it('passes tenantId to triggerService.trigger', async () => {
      const handler = await captureHandler(listener);
      await handler(makeEvent({ tenantId: 'tenant-99' }), {});

      expect(mockTriggerService.trigger).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-99' }),
      );
    });
  });
});
