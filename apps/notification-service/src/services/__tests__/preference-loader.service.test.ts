import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferenceLoaderService } from '../preference-loader.service';

function makePrismaClient(configRow: object | null = null) {
  return {
    instituteNotificationConfig: {
      findUnique: vi.fn().mockResolvedValue(configRow),
    },
  };
}

function makeConfigRow(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-abc',
    notificationType: 'ATTENDANCE',
    inAppEnabled: true,
    whatsappEnabled: true,
    emailEnabled: true,
    pushEnabled: false,
    digestEnabled: false,
    digestCron: null,
    ...overrides,
  };
}

describe('PreferenceLoaderService', () => {
  let service: PreferenceLoaderService;
  let mockPrisma: ReturnType<typeof makePrismaClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = makePrismaClient();
    service = new PreferenceLoaderService(mockPrisma as never);
  });

  describe('loadConfig', () => {
    it('returns correct values when config exists in DB', async () => {
      const row = makeConfigRow({
        inAppEnabled: true,
        whatsappEnabled: false,
        emailEnabled: true,
        pushEnabled: true,
        digestEnabled: true,
        digestCron: '0 8 * * *',
      });
      mockPrisma.instituteNotificationConfig.findUnique.mockResolvedValueOnce(row);

      const result = await service.loadConfig('tenant-abc', 'ATTENDANCE');

      expect(result).toEqual({
        inApp: true,
        whatsapp: false,
        email: true,
        push: true,
        digest: true,
        digestCron: '0 8 * * *',
      });
    });

    it('queries DB with the correct tenantId and notificationType key', async () => {
      const row = makeConfigRow();
      mockPrisma.instituteNotificationConfig.findUnique.mockResolvedValueOnce(row);

      await service.loadConfig('tenant-xyz', 'FEE');

      expect(mockPrisma.instituteNotificationConfig.findUnique).toHaveBeenCalledWith({
        where: {
          tenantId_notificationType: { tenantId: 'tenant-xyz', notificationType: 'FEE' },
        },
      });
    });

    it('returns defaults when no config row is found', async () => {
      mockPrisma.instituteNotificationConfig.findUnique.mockResolvedValueOnce(null);

      const result = await service.loadConfig('tenant-abc', 'ATTENDANCE');

      expect(result).toEqual({
        inApp: true,
        whatsapp: true,
        email: true,
        push: false,
        digest: false,
      });
    });

    it('default config has no digestCron', async () => {
      mockPrisma.instituteNotificationConfig.findUnique.mockResolvedValueOnce(null);

      const result = await service.loadConfig('tenant-abc', 'ATTENDANCE');

      expect(result.digestCron).toBeUndefined();
    });

    it('returns undefined digestCron when DB digestCron is null', async () => {
      const row = makeConfigRow({ digestCron: null });
      mockPrisma.instituteNotificationConfig.findUnique.mockResolvedValueOnce(row);

      const result = await service.loadConfig('tenant-abc', 'ATTENDANCE');

      expect(result.digestCron).toBeUndefined();
    });

    it('returns digestCron string when set in DB', async () => {
      const row = makeConfigRow({ digestEnabled: true, digestCron: '0 9 * * 1-5' });
      mockPrisma.instituteNotificationConfig.findUnique.mockResolvedValueOnce(row);

      const result = await service.loadConfig('tenant-abc', 'ATTENDANCE');

      expect(result.digestCron).toBe('0 9 * * 1-5');
    });

    it('returns fresh default object each call (no shared reference)', async () => {
      mockPrisma.instituteNotificationConfig.findUnique.mockResolvedValue(null);

      const result1 = await service.loadConfig('tenant-1', 'ATTENDANCE');
      const result2 = await service.loadConfig('tenant-2', 'ATTENDANCE');

      result1.inApp = false;
      expect(result2.inApp).toBe(true);
    });
  });
});
