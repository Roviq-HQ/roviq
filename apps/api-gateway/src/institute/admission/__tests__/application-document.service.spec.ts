import { createMongoAbility } from '@casl/ability';
import type { InstituteReadAccess } from '@roviq/casl';
import type { AppAbility, InstituteContext, UserDocumentType } from '@roviq/common-types';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileService } from '../../../files/file.service';
import type {
  ApplicationDocumentRecord,
  ApplicationDocumentRepository,
} from '../application-document.repository';
import { ApplicationDocumentService } from '../application-document.service';

const APPLICATION_ID = '00000000-0000-7000-a000-000000000001';
const FILE_ID = '00000000-0000-7000-a000-000000000002';

function buildDocument(type: UserDocumentType, id: string): ApplicationDocumentRecord {
  return {
    id,
    applicationId: APPLICATION_ID,
    type,
    files: [],
    createdAt: new Date('2026-11-20T00:00:00Z'),
  };
}

describe('ApplicationDocumentService', () => {
  const user = createMock<InstituteContext>({ tenantId: 'tenant-1', userId: 'user-1' });
  const calls: string[] = [];
  let list: ReturnType<typeof vi.fn<ApplicationDocumentRepository['list']>>;
  let assertOpenApplication: ReturnType<
    typeof vi.fn<ApplicationDocumentRepository['assertOpenApplication']>
  >;
  let add: ReturnType<typeof vi.fn<ApplicationDocumentRepository['add']>>;
  let verifyUploads: ReturnType<typeof vi.fn<FileService['verifyUploads']>>;
  let service: ApplicationDocumentService;

  const birth = buildDocument('BIRTH_CERTIFICATE', 'doc-birth');
  const aadhaar = buildDocument('AADHAAR_CARD', 'doc-aadhaar');

  beforeEach(() => {
    calls.length = 0;
    list = vi.fn<ApplicationDocumentRepository['list']>().mockResolvedValue([birth, aadhaar]);
    assertOpenApplication = vi.fn<ApplicationDocumentRepository['assertOpenApplication']>(
      async () => {
        calls.push('assertOpen');
      },
    );
    add = vi.fn<ApplicationDocumentRepository['add']>(async () => {
      calls.push('add');
      return birth;
    });
    verifyUploads = vi.fn<FileService['verifyUploads']>(async () => {
      calls.push('verify');
    });
    service = new ApplicationDocumentService(
      createMock<ApplicationDocumentRepository>({ list, assertOpenApplication, add }),
      createMock<FileService>({ verifyUploads }),
    );
  });

  function accessWith(ability: AppAbility): InstituteReadAccess {
    return { user, ability };
  }

  describe('list', () => {
    it('should hide Aadhaar scans from a user who may not read the Aadhaar field', async () => {
      const ability = createMongoAbility<AppAbility>([
        { action: 'read', subject: 'Application' },
        { action: 'read', subject: 'Student', fields: ['id', 'admissionNumber'] },
      ]);

      const documents = await service.list(APPLICATION_ID, accessWith(ability));

      expect(documents).toEqual([birth]);
    });

    it('should show Aadhaar scans to a user who may read the Aadhaar field', async () => {
      const ability = createMongoAbility<AppAbility>([
        { action: 'read', subject: 'Application' },
        { action: 'read', subject: 'Student', fields: ['aadhaar'] },
      ]);

      const documents = await service.list(APPLICATION_ID, accessWith(ability));

      expect(documents).toEqual([birth, aadhaar]);
    });
  });

  describe('add', () => {
    const input = {
      applicationId: APPLICATION_ID,
      type: 'BIRTH_CERTIFICATE' as const,
      fileIds: [FILE_ID],
    };

    it('should check the application, then the uploads, then save', async () => {
      const saved = await service.add(user, input);

      expect(saved).toBe(birth);
      expect(calls).toEqual(['assertOpen', 'verify', 'add']);
      expect(verifyUploads).toHaveBeenCalledWith([FILE_ID], 'APPLICATION_DOCUMENT');
      expect(add).toHaveBeenCalledWith(user, input);
    });

    it('should not touch the uploads of a closed application', async () => {
      assertOpenApplication.mockRejectedValue(new Error('closed'));

      await expect(service.add(user, input)).rejects.toThrow('closed');
      expect(verifyUploads).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();
    });
  });
});
