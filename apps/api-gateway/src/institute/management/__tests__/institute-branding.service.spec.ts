import type { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IdentityService } from '../../../auth/identity.service';
import type { FileService } from '../../../files/file.service';
import { InstituteService } from '../institute.service';
import type { InstituteRepository } from '../repositories/institute.repository';
import type { InstituteRecord } from '../repositories/types';
import type { InstituteSetupService } from '../seed/institute-setup.service';

const INSTITUTE_ID = '00000000-0000-7000-a000-000000000101';
const LOGO_ID = '00000000-0000-7000-a000-000000000001';
const COVER_ID = '00000000-0000-7000-a000-000000000002';

describe('InstituteService.updateBranding', () => {
  const record = createMock<InstituteRecord>({ id: INSTITUTE_ID });
  const calls: string[] = [];
  let verifyUploads: ReturnType<typeof vi.fn<FileService['verifyUploads']>>;
  let updateBranding: ReturnType<typeof vi.fn<InstituteRepository['updateBranding']>>;
  let emit: ReturnType<typeof vi.fn<EventBusService['emit']>>;
  let service: InstituteService;

  beforeEach(() => {
    calls.length = 0;
    verifyUploads = vi.fn<FileService['verifyUploads']>(async (_ids, purpose) => {
      calls.push(`verify:${purpose}`);
    });
    updateBranding = vi.fn<InstituteRepository['updateBranding']>(async () => {
      calls.push('save');
      return record;
    });
    emit = vi.fn<EventBusService['emit']>();
    service = new InstituteService(
      createMock<InstituteRepository>({ updateBranding }),
      createMock<InstituteSetupService>(),
      createMock<EventBusService>({ emit }),
      createMock<FileService>({ verifyUploads }),
      createMock<IdentityService>(),
    );
  });

  it('should check each new image against its own purpose before saving', async () => {
    const input = { logoFileId: LOGO_ID, coverImageFileId: COVER_ID };

    const saved = await service.updateBranding(INSTITUTE_ID, input);

    expect(saved).toBe(record);
    expect(calls).toEqual(['verify:INSTITUTE_LOGO', 'verify:INSTITUTE_COVER', 'save']);
    expect(verifyUploads).toHaveBeenCalledWith([LOGO_ID], 'INSTITUTE_LOGO');
    expect(verifyUploads).toHaveBeenCalledWith([COVER_ID], 'INSTITUTE_COVER');
    expect(updateBranding).toHaveBeenCalledWith(INSTITUTE_ID, input);
  });

  it('should not check storage when an image is removed or left as it is', async () => {
    const input = { logoFileId: null, primaryColor: '#1e40af' };

    await service.updateBranding(INSTITUTE_ID, input);

    expect(verifyUploads).not.toHaveBeenCalled();
    expect(updateBranding).toHaveBeenCalledWith(INSTITUTE_ID, input);
  });

  it('should save nothing when an upload is refused', async () => {
    verifyUploads.mockRejectedValue(new Error('refused'));

    await expect(service.updateBranding(INSTITUTE_ID, { logoFileId: LOGO_ID })).rejects.toThrow(
      'refused',
    );
    expect(updateBranding).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('should announce the change for the institute', async () => {
    const input = { faviconFileId: null };

    await service.updateBranding(INSTITUTE_ID, input);

    expect(emit).toHaveBeenCalledWith(EVENT_PATTERNS.INSTITUTE.branding_updated, {
      instituteId: INSTITUTE_ID,
      tenantId: INSTITUTE_ID,
      branding: input,
    });
  });
});
