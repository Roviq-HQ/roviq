import type { AbilityFactory } from '@roviq/casl';
import {
  type AppAbility,
  ErrorCode,
  type FilePurpose,
  type InstituteContext,
} from '@roviq/common-types';
import { FakeStorageClient } from '@roviq/storage';
import { createMock } from '@roviq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestFileUploadInput } from '../dto/request-file-upload.input';
import {
  AUDITED_DOWNLOAD_URL_TTL_SECONDS,
  DOWNLOAD_URL_TTL_SECONDS,
  FileService,
  MAX_PENDING_UPLOADS_PER_USER,
} from '../file.service';
import type { FileRepository } from '../repositories/file.repository';
import type { CreateFileData, FileRecord } from '../repositories/types';

const TENANT_ID = '00000000-0000-7000-a000-000000000001';
const USER_ID = '00000000-0000-7000-a000-000000000002';
const FILE_ID = '00000000-0000-7000-a000-000000000003';
const KEY = `institutes/${TENANT_ID}/leave-attachment/${FILE_ID}.pdf`;
const PDF = Buffer.from('%PDF-1.7\nhello');

const user = createMock<InstituteContext>({ scope: 'institute', tenantId: TENANT_ID });

function buildFile(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    id: FILE_ID,
    tenantId: TENANT_ID,
    resellerId: null,
    subjectUserId: null,
    visibility: 'PRIVATE',
    purpose: 'LEAVE_ATTACHMENT',
    objectKey: KEY,
    originalName: 'certificate.pdf',
    contentType: 'application/pdf',
    sizeBytes: PDF.length,
    status: 'PENDING',
    uploadedBy: USER_ID,
    createdAt: new Date('2026-11-19T10:00:00Z'),
    ...overrides,
  };
}

function buildInput(overrides: Partial<RequestFileUploadInput> = {}): RequestFileUploadInput {
  return {
    purpose: 'LEAVE_ATTACHMENT',
    fileName: 'certificate.pdf',
    contentType: 'application/pdf',
    sizeBytes: PDF.length,
    ...overrides,
  };
}

describe('FileService', () => {
  let storage: FakeStorageClient;
  let can: ReturnType<typeof vi.fn<AppAbility['can']>>;
  let create: ReturnType<typeof vi.fn<FileRepository['create']>>;
  let findClaimable: ReturnType<typeof vi.fn<FileRepository['findClaimable']>>;
  let findById: ReturnType<typeof vi.fn<FileRepository['findById']>>;
  let countPending: ReturnType<typeof vi.fn<FileRepository['countPendingByCurrentUser']>>;
  let markRejected: ReturnType<typeof vi.fn<FileRepository['markRejected']>>;
  let service: FileService;

  beforeEach(() => {
    storage = new FakeStorageClient();
    can = vi.fn<AppAbility['can']>().mockReturnValue(true);
    create = vi.fn<FileRepository['create']>(async (data: CreateFileData) =>
      buildFile({
        objectKey: data.objectKey(FILE_ID),
        originalName: data.originalName,
        contentType: data.contentType,
        sizeBytes: data.sizeBytes,
        purpose: data.purpose,
        visibility: data.visibility,
      }),
    );
    findClaimable = vi.fn<FileRepository['findClaimable']>().mockResolvedValue([]);
    findById = vi.fn<FileRepository['findById']>().mockResolvedValue(null);
    countPending = vi.fn<FileRepository['countPendingByCurrentUser']>().mockResolvedValue(0);
    markRejected = vi.fn<FileRepository['markRejected']>().mockResolvedValue(undefined);
    service = new FileService(
      createMock<FileRepository>({
        create,
        findClaimable,
        findById,
        countPendingByCurrentUser: countPending,
        markRejected,
      }),
      storage,
      createMock<AbilityFactory>({
        createForUser: vi.fn().mockResolvedValue(createMock<AppAbility>({ can })),
      }),
    );
  });

  describe('requestUpload', () => {
    it('should store a pending file under the institute prefix and return a signed PUT', async () => {
      const ticket = await service.requestUpload(user, buildInput());

      expect(ticket.fileId).toBe(FILE_ID);
      expect(ticket.uploadUrl).toBe(`fake://private/${KEY}?put&length=${PDF.length}`);
      expect(ticket.headers).toEqual([{ name: 'Content-Type', value: 'application/pdf' }]);
      expect(can).toHaveBeenCalledWith('create', 'Leave');
    });

    it('should keep only the base name of a file name that carries a path', async () => {
      await service.requestUpload(user, buildInput({ fileName: '../../etc/प्रमाण पत्र.pdf' }));

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ originalName: 'प्रमाण पत्र.pdf' }),
      );
    });

    it('should refuse a type the purpose does not allow', async () => {
      await expect(
        service.requestUpload(user, buildInput({ contentType: 'application/x-msdownload' })),
      ).rejects.toMatchObject({ code: ErrorCode.FILE_TYPE_NOT_ALLOWED });
      expect(create).not.toHaveBeenCalled();
    });

    it('should refuse a CSV for a leave attachment even though CSV is a known type', async () => {
      await expect(
        service.requestUpload(user, buildInput({ contentType: 'text/csv' })),
      ).rejects.toMatchObject({ code: ErrorCode.FILE_TYPE_NOT_ALLOWED });
    });

    it('should accept a file of exactly the limit and refuse one byte more', async () => {
      const limit = 10 * 1024 * 1024;

      await expect(
        service.requestUpload(user, buildInput({ sizeBytes: limit })),
      ).resolves.toMatchObject({ fileId: FILE_ID });
      await expect(
        service.requestUpload(user, buildInput({ sizeBytes: limit + 1 })),
      ).rejects.toMatchObject({ code: ErrorCode.FILE_TOO_LARGE });
    });

    it('should refuse a user without the ability the purpose needs', async () => {
      can.mockReturnValue(false);

      await expect(service.requestUpload(user, buildInput())).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
      expect(create).not.toHaveBeenCalled();
    });

    it('should refuse a purpose only the server may write, whatever the abilities', async () => {
      const purpose: FilePurpose = 'BULK_IMPORT_REPORT';

      await expect(
        service.requestUpload(user, buildInput({ purpose, contentType: 'text/csv' })),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });

    it('should refuse a new upload once the user has the maximum pending', async () => {
      countPending.mockResolvedValue(MAX_PENDING_UPLOADS_PER_USER);

      await expect(service.requestUpload(user, buildInput())).rejects.toMatchObject({
        code: ErrorCode.FILE_UPLOAD_LIMIT_REACHED,
      });
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('verifyUploads', () => {
    it('should pass when the stored object matches the declared size and type', async () => {
      findClaimable.mockResolvedValue([buildFile()]);
      storage.simulateUpload('private', KEY, PDF, 'application/pdf');

      await expect(service.verifyUploads([FILE_ID], 'LEAVE_ATTACHMENT')).resolves.toBeUndefined();
      expect(markRejected).not.toHaveBeenCalled();
    });

    it('should look each id up once when it is given twice', async () => {
      findClaimable.mockResolvedValue([buildFile()]);
      storage.simulateUpload('private', KEY, PDF, 'application/pdf');

      await service.verifyUploads([FILE_ID, FILE_ID], 'LEAVE_ATTACHMENT');

      expect(findClaimable).toHaveBeenCalledWith([FILE_ID], 'LEAVE_ATTACHMENT');
    });

    it('should refuse an id that is not claimable by this user for this purpose', async () => {
      findClaimable.mockResolvedValue([]);

      await expect(service.verifyUploads([FILE_ID], 'LEAVE_ATTACHMENT')).rejects.toMatchObject({
        code: ErrorCode.FILE_NOT_FOUND,
      });
    });

    it('should reject the file when nothing was uploaded', async () => {
      findClaimable.mockResolvedValue([buildFile()]);

      await expect(service.verifyUploads([FILE_ID], 'LEAVE_ATTACHMENT')).rejects.toMatchObject({
        code: ErrorCode.FILE_CONTENT_MISMATCH,
      });
      expect(markRejected).toHaveBeenCalledWith(FILE_ID);
    });

    it('should reject and delete an object whose bytes are not the declared type', async () => {
      const exe = Buffer.from('MZ not a pdf!!');
      findClaimable.mockResolvedValue([buildFile({ sizeBytes: exe.length })]);
      storage.simulateUpload('private', KEY, exe, 'application/pdf');

      await expect(service.verifyUploads([FILE_ID], 'LEAVE_ATTACHMENT')).rejects.toMatchObject({
        code: ErrorCode.FILE_CONTENT_MISMATCH,
      });
      expect(markRejected).toHaveBeenCalledWith(FILE_ID);
      expect(storage.has('private', KEY)).toBe(false);
    });

    it('should reject an object whose size differs from the declared size', async () => {
      findClaimable.mockResolvedValue([buildFile({ sizeBytes: PDF.length + 1 })]);
      storage.simulateUpload('private', KEY, PDF, 'application/pdf');

      await expect(service.verifyUploads([FILE_ID], 'LEAVE_ATTACHMENT')).rejects.toMatchObject({
        code: ErrorCode.FILE_CONTENT_MISMATCH,
      });
    });

    it('should do nothing for an empty list', async () => {
      await service.verifyUploads([], 'LEAVE_ATTACHMENT');

      expect(findClaimable).not.toHaveBeenCalled();
    });
  });

  describe('toRef', () => {
    it('should sign a private file for the normal download lifetime', async () => {
      const ref = await service.toRef(buildFile({ status: 'READY' }));

      expect(ref).toEqual({
        id: FILE_ID,
        name: 'certificate.pdf',
        contentType: 'application/pdf',
        sizeBytes: PDF.length,
        url: `fake://private/${KEY}?get&expires=${DOWNLOAD_URL_TTL_SECONDS}&at=now`,
      });
    });

    it('should give a public file its stable URL', async () => {
      const ref = await service.toRef(buildFile({ status: 'READY', visibility: 'PUBLIC' }));

      expect(ref.url).toBe(`fake://public/${KEY}`);
    });
  });

  describe('downloadUrl', () => {
    it('should return a short-lived URL for a ready file the user may read', async () => {
      findById.mockResolvedValue(buildFile({ status: 'READY' }));

      const url = await service.downloadUrl(user, FILE_ID);

      expect(url).toBe(
        `fake://private/${KEY}?get&expires=${AUDITED_DOWNLOAD_URL_TTL_SECONDS}&at=now`,
      );
      expect(can).toHaveBeenCalledWith('read', 'Leave');
    });

    it.each([
      'PENDING',
      'REJECTED',
      'DELETED',
    ] as const)('should answer not found for a %s file', async (status) => {
      findById.mockResolvedValue(buildFile({ status }));

      await expect(service.downloadUrl(user, FILE_ID)).rejects.toMatchObject({
        code: ErrorCode.FILE_NOT_FOUND,
      });
    });

    it('should answer not found, not forbidden, when the user lacks the ability', async () => {
      findById.mockResolvedValue(buildFile({ status: 'READY' }));
      can.mockReturnValue(false);

      await expect(service.downloadUrl(user, FILE_ID)).rejects.toMatchObject({
        code: ErrorCode.FILE_NOT_FOUND,
      });
    });

    it("should answer not found for a file outside the caller's institute", async () => {
      findById.mockResolvedValue(null);

      await expect(service.downloadUrl(user, FILE_ID)).rejects.toMatchObject({
        code: ErrorCode.FILE_NOT_FOUND,
      });
    });
  });
});
