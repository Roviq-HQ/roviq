import {
  BusinessException,
  ErrorCode,
  ResellerBrandingTheme,
  type ResellerContext,
} from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileService } from '../../../files/file.service';
import {
  type ResellerRecord,
  ResellerSettingsRepository,
} from '../repositories/reseller-settings.repository';
import { mergeBranding, ResellerSettingsService } from '../reseller-settings.service';

const RESELLER_ID = '019a0000-0000-7000-8000-000000000001';
const USER_ID = '019a0000-0000-7000-8000-000000000002';

const OLD_LOGO = '019a0000-0000-7000-8000-0000000000b1';
const NEW_LOGO = '019a0000-0000-7000-8000-0000000000b2';
const OLD_ICON = '019a0000-0000-7000-8000-0000000000b3';

const ctx: ResellerContext = {
  _scope: 'reseller',
  scope: 'reseller',
  userId: USER_ID,
  resellerId: RESELLER_ID,
  membershipId: '019a0000-0000-7000-8000-000000000003',
  roleId: '019a0000-0000-7000-8000-000000000004',
  type: 'access',
};

function buildReseller(overrides: Partial<ResellerRecord> = {}): ResellerRecord {
  return {
    id: RESELLER_ID,
    name: 'Acme Partners',
    slug: 'acme-partners',
    tier: 'FULL_MANAGEMENT',
    isSystem: false,
    isActive: true,
    status: 'ACTIVE',
    suspendedAt: null,
    branding: {},
    logoFileId: null,
    faviconFileId: null,
    customDomain: null,
    registrationNumber: null,
    registrationState: null,
    contact: { phones: [], emails: [] },
    address: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: USER_ID,
    updatedBy: USER_ID,
    deletedAt: null,
    deletedBy: null,
    version: 3,
    ...overrides,
  };
}

describe('mergeBranding', () => {
  it('should leave an omitted key as stored and remove a key sent as null', () => {
    const merged = mergeBranding(
      { primaryColor: '#112233', secondaryColor: '#445566', theme: 'DARK', customCss: '.a{}' },
      { secondaryColor: null, theme: ResellerBrandingTheme.LIGHT },
    );
    expect(merged).toEqual({ primaryColor: '#112233', theme: 'LIGHT', customCss: '.a{}' });
  });

  it('should treat an empty stylesheet as removal', () => {
    expect(mergeBranding({ customCss: '.a{}' }, { customCss: '' })).toEqual({});
  });

  it('should start from an empty object when nothing is stored', () => {
    expect(mergeBranding(null, { theme: ResellerBrandingTheme.AUTO })).toEqual({ theme: 'AUTO' });
  });
});

describe('ResellerSettingsService', () => {
  let repo: ReturnType<typeof createMock<ResellerSettingsRepository>>;
  let eventBus: ReturnType<typeof createMock<EventBusService>>;
  let files: ReturnType<typeof createMock<FileService>>;
  let service: ResellerSettingsService;

  beforeEach(() => {
    repo = createMock<ResellerSettingsRepository>({
      findOwn: vi.fn().mockResolvedValue(buildReseller()),
      updateOwn: vi
        .fn()
        .mockImplementation(async (_ctx, _version, patch) =>
          buildReseller({ ...patch, version: 4 }),
        ),
      countOwn: vi.fn().mockResolvedValue({ instituteCount: 2, teamSize: 5 }),
    });
    eventBus = createMock<EventBusService>({ emit: vi.fn() });
    files = createMock<FileService>({ verifyUploads: vi.fn().mockResolvedValue(undefined) });
    service = new ResellerSettingsService(repo, eventBus, files);
  });

  describe('getProfile', () => {
    it('should return the stored record', async () => {
      await expect(service.getProfile(ctx)).resolves.toEqual(buildReseller());
      expect(repo.findOwn).toHaveBeenCalledWith(ctx);
    });

    it('should answer RESELLER_NOT_FOUND when the record is gone', async () => {
      repo.findOwn.mockResolvedValue(null);
      await expect(service.getProfile(ctx)).rejects.toMatchObject({
        code: ErrorCode.RESELLER_NOT_FOUND,
      });
    });
  });

  describe('updateProfile', () => {
    it('should write only the fields that were sent, under the given version', async () => {
      await service.updateProfile(ctx, {
        version: 3,
        name: 'Acme Education',
        registrationNumber: null,
      });
      expect(repo.updateOwn).toHaveBeenCalledWith(
        ctx,
        3,
        { name: 'Acme Education', registrationNumber: null },
        undefined,
      );
    });

    it('should leave name and contact alone when they arrive as null', async () => {
      await service.updateProfile(ctx, {
        version: 3,
        name: null,
        contact: null,
        registrationNumber: 'U1',
      });
      expect(repo.updateOwn).toHaveBeenCalledWith(ctx, 3, { registrationNumber: 'U1' }, undefined);
    });

    it('should tell the platform about the change, with the counts its reseller list shows', async () => {
      const updated = await service.updateProfile(ctx, { version: 3, name: 'Acme Education' });
      expect(eventBus.emit).toHaveBeenCalledWith(EVENT_PATTERNS.RESELLER.updated, {
        ...updated,
        instituteCount: 2,
        teamSize: 5,
        actorId: USER_ID,
        scope: 'platform',
      });
    });

    it('should answer CONCURRENT_MODIFICATION and emit nothing when the version is stale', async () => {
      repo.updateOwn.mockResolvedValue(null);
      await expect(
        service.updateProfile(ctx, { version: 2, name: 'Acme Education' }),
      ).rejects.toMatchObject({ code: ErrorCode.CONCURRENT_MODIFICATION });
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('should refuse to rename the system reseller', async () => {
      repo.findOwn.mockResolvedValue(buildReseller({ isSystem: true, name: 'Roviq Direct' }));
      const attempt = service.updateProfile(ctx, { version: 3, name: 'Renamed' });
      await expect(attempt).rejects.toBeInstanceOf(BusinessException);
      await expect(attempt).rejects.toMatchObject({ code: ErrorCode.SYSTEM_RESELLER_PROTECTED });
      expect(repo.updateOwn).not.toHaveBeenCalled();
    });

    it('should let the system reseller edit other fields, and resend its unchanged name', async () => {
      repo.findOwn.mockResolvedValue(buildReseller({ isSystem: true, name: 'Roviq Direct' }));
      await service.updateProfile(ctx, {
        version: 3,
        name: 'Roviq Direct',
        registrationNumber: 'U12345',
      });
      expect(repo.updateOwn).toHaveBeenCalledWith(
        ctx,
        3,
        { name: 'Roviq Direct', registrationNumber: 'U12345' },
        undefined,
      );
    });
  });

  describe('updateBranding', () => {
    it('should merge the edited keys into the stored branding', async () => {
      repo.findOwn.mockResolvedValue(buildReseller({ branding: { theme: 'DARK' } }));
      await service.updateBranding(ctx, {
        version: 3,
        primaryColor: '#112233',
        theme: null,
      });
      expect(repo.updateOwn).toHaveBeenCalledWith(
        ctx,
        3,
        { branding: { primaryColor: '#112233' } },
        { attach: [], detach: [] },
      );
    });

    it('should verify a new logo, attach it and detach the one it replaces', async () => {
      repo.findOwn.mockResolvedValue(buildReseller({ logoFileId: OLD_LOGO }));

      await service.updateBranding(ctx, { version: 3, logoFileId: NEW_LOGO });

      expect(files.verifyUploads).toHaveBeenCalledWith([NEW_LOGO], 'RESELLER_LOGO');
      expect(repo.updateOwn).toHaveBeenCalledWith(
        ctx,
        3,
        { branding: {}, logoFileId: NEW_LOGO },
        { attach: [{ fileId: NEW_LOGO, purpose: 'RESELLER_LOGO' }], detach: [OLD_LOGO] },
      );
    });

    it('should remove the favicon when it is sent as null, without touching storage', async () => {
      repo.findOwn.mockResolvedValue(buildReseller({ faviconFileId: OLD_ICON }));

      await service.updateBranding(ctx, { version: 3, faviconFileId: null });

      expect(files.verifyUploads).not.toHaveBeenCalled();
      expect(repo.updateOwn).toHaveBeenCalledWith(
        ctx,
        3,
        { branding: {}, faviconFileId: null },
        { attach: [], detach: [OLD_ICON] },
      );
    });

    it('should leave both files alone when neither is sent or the same id is resent', async () => {
      repo.findOwn.mockResolvedValue(
        buildReseller({ logoFileId: OLD_LOGO, faviconFileId: OLD_ICON }),
      );

      await service.updateBranding(ctx, { version: 3, logoFileId: OLD_LOGO });

      expect(files.verifyUploads).not.toHaveBeenCalled();
      expect(repo.updateOwn).toHaveBeenCalledWith(
        ctx,
        3,
        { branding: {} },
        { attach: [], detach: [] },
      );
    });

    it('should save nothing when the upload fails verification', async () => {
      files.verifyUploads.mockRejectedValue(
        new BusinessException(ErrorCode.FILE_IMAGE_INVALID, 'bad image'),
      );

      await expect(
        service.updateBranding(ctx, { version: 3, logoFileId: NEW_LOGO }),
      ).rejects.toMatchObject({ code: ErrorCode.FILE_IMAGE_INVALID });
      expect(repo.updateOwn).not.toHaveBeenCalled();
    });

    it('should answer CONCURRENT_MODIFICATION when the version is stale', async () => {
      repo.updateOwn.mockResolvedValue(null);
      await expect(
        service.updateBranding(ctx, { version: 1, primaryColor: '#112233' }),
      ).rejects.toMatchObject({ code: ErrorCode.CONCURRENT_MODIFICATION });
    });
  });
});
