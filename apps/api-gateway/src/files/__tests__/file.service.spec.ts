import { createMongoAbility, subject } from '@casl/ability';
import type { AbilityFactory } from '@roviq/casl';
import {
  type AppAbility,
  ErrorCode,
  FILE_PURPOSE_POLICY,
  type FilePurpose,
  type InstituteContext,
  type ResellerContext,
} from '@roviq/common-types';
import { FakeStorageClient } from '@roviq/storage';
import { createMock } from '@roviq/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestFileUploadInput } from '../dto/request-file-upload.input';
import {
  AUDITED_DOWNLOAD_URL_TTL_SECONDS,
  DOWNLOAD_URL_TTL_SECONDS,
  FileService,
  MAX_PENDING_UPLOADS_PER_USER,
  THUMBNAIL_URL_TTL_SECONDS,
  THUMBNAIL_URL_WINDOW_SECONDS,
} from '../file.service';
import { ImageProcessor, InvalidImageError, type ProcessedImage } from '../image/image-processor';
import type { FileRepository } from '../repositories/file.repository';
import type { CreateFileData, FileRecord } from '../repositories/types';

const TENANT_ID = '00000000-0000-7000-a000-000000000001';
const USER_ID = '00000000-0000-7000-a000-000000000002';
const FILE_ID = '00000000-0000-7000-a000-000000000003';
const KEY = `institutes/${TENANT_ID}/leave-attachment/${FILE_ID}.pdf`;
const PENDING_KEY = `pending/${KEY}`;
const LEAVE_ID = '00000000-0000-7000-a000-000000000004';
const OTHER_USER_ID = '00000000-0000-7000-a000-000000000005';
const DOCUMENT_ID = '00000000-0000-7000-a000-000000000006';
const DOCUMENT_KEY = `users/${OTHER_USER_ID}/user-document/${FILE_ID}.pdf`;
const PDF = Buffer.from('%PDF-1.7\nhello');

const user = createMock<InstituteContext>({ scope: 'institute', tenantId: TENANT_ID });
const RESELLER_ID = '019a0000-0000-7000-8000-0000000000aa';
const resellerUser = createMock<ResellerContext>({ scope: 'reseller', resellerId: RESELLER_ID });

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
    width: null,
    height: null,
    variants: null,
    placeholder: null,
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

const IMAGE_KEY = `institutes/${TENANT_ID}/leave-attachment/${FILE_ID}.jpg`;
const IMAGE_BASE = `institutes/${TENANT_ID}/leave-attachment/${FILE_ID}`;
const PHOTO = Buffer.from('raw photo bytes as uploaded');
const PROCESSED: ProcessedImage = {
  variants: [
    { name: 'SM', data: Buffer.from('sm'), width: 128, height: 96 },
    { name: 'MD', data: Buffer.from('medium'), width: 512, height: 384 },
    { name: 'FULL', data: Buffer.from('full-size'), width: 2000, height: 1500 },
  ],
  placeholder: 'data:image/webp;base64,AAAA',
};

function buildImage(overrides: Partial<FileRecord> = {}): FileRecord {
  return buildFile({
    objectKey: IMAGE_KEY,
    originalName: 'scan.jpg',
    contentType: 'image/jpeg',
    sizeBytes: PHOTO.length,
    ...overrides,
  });
}

/** A stored, processed image as the repository returns it. */
function buildStoredImage(overrides: Partial<FileRecord> = {}): FileRecord {
  return buildImage({
    contentType: 'image/webp',
    status: 'READY',
    width: 2000,
    height: 1500,
    placeholder: PROCESSED.placeholder,
    variants: [
      { name: 'SM', width: 128, height: 96, sizeBytes: 2 },
      { name: 'MD', width: 512, height: 384, sizeBytes: 6 },
      { name: 'FULL', width: 2000, height: 1500, sizeBytes: 9 },
    ],
    sizeBytes: 17,
    ...overrides,
  });
}

class FakeImageProcessor extends ImageProcessor {
  process = vi.fn<ImageProcessor['process']>().mockResolvedValue(PROCESSED);
}

describe('FileService', () => {
  let storage: FakeStorageClient;
  let can: ReturnType<typeof vi.fn<AppAbility['can']>>;
  let create: ReturnType<typeof vi.fn<FileRepository['create']>>;
  let findClaimable: ReturnType<typeof vi.fn<FileRepository['findClaimable']>>;
  let findById: ReturnType<typeof vi.fn<FileRepository['findById']>>;
  let countPending: ReturnType<typeof vi.fn<FileRepository['countPendingByCurrentUser']>>;
  let markRejected: ReturnType<typeof vi.fn<FileRepository['markRejected']>>;
  let markReady: ReturnType<typeof vi.fn<FileRepository['markReady']>>;
  let findLeaveForFile: ReturnType<typeof vi.fn<FileRepository['findLeaveForFile']>>;
  let findStudentDocumentForFile: ReturnType<
    typeof vi.fn<FileRepository['findStudentDocumentForFile']>
  >;
  let findApplicationDocumentForFile: ReturnType<
    typeof vi.fn<FileRepository['findApplicationDocumentForFile']>
  >;
  let createForUser: ReturnType<typeof vi.fn<AbilityFactory['createForUser']>>;
  let saveProcessedImage: ReturnType<typeof vi.fn<FileRepository['saveProcessedImage']>>;
  let images: FakeImageProcessor;
  let isMember: ReturnType<typeof vi.fn<FileRepository['isMemberOfCurrentTenant']>>;
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
    markReady = vi.fn<FileRepository['markReady']>().mockResolvedValue(undefined);
    findLeaveForFile = vi
      .fn<FileRepository['findLeaveForFile']>()
      .mockResolvedValue({ id: LEAVE_ID, tenantId: TENANT_ID, userId: USER_ID });
    findStudentDocumentForFile = vi
      .fn<FileRepository['findStudentDocumentForFile']>()
      .mockResolvedValue({ id: DOCUMENT_ID, type: 'BIRTH_CERTIFICATE' });
    findApplicationDocumentForFile = vi
      .fn<FileRepository['findApplicationDocumentForFile']>()
      .mockResolvedValue({ id: DOCUMENT_ID, type: 'BIRTH_CERTIFICATE' });
    createForUser = vi
      .fn<AbilityFactory['createForUser']>()
      .mockResolvedValue(createMock<AppAbility>({ can }));
    saveProcessedImage = vi.fn<FileRepository['saveProcessedImage']>().mockResolvedValue(undefined);
    images = new FakeImageProcessor();
    isMember = vi.fn<FileRepository['isMemberOfCurrentTenant']>().mockResolvedValue(true);
    service = new FileService(
      createMock<FileRepository>({
        create,
        findClaimable,
        findById,
        countPendingByCurrentUser: countPending,
        markRejected,
        markReady,
        findLeaveForFile,
        findStudentDocumentForFile,
        findApplicationDocumentForFile,
        saveProcessedImage,
        isMemberOfCurrentTenant: isMember,
      }),
      storage,
      createMock<AbilityFactory>({ createForUser }),
      images,
    );
  });

  describe('requestUpload', () => {
    it('should return a signed PUT for the pending key, never the key the file is served from', async () => {
      const ticket = await service.requestUpload(user, buildInput());

      expect(ticket.fileId).toBe(FILE_ID);
      expect(ticket.uploadUrl).toBe(`fake://private/${PENDING_KEY}?put&length=${PDF.length}`);
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

    it('should store a profile photo under the person, not under the institute', async () => {
      const ticket = await service.requestUpload(
        user,
        buildInput({
          purpose: 'PROFILE_PHOTO',
          contentType: 'image/jpeg',
          fileName: 'me.jpg',
          subjectUserId: OTHER_USER_ID,
        }),
      );

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ subjectUserId: OTHER_USER_ID, purpose: 'PROFILE_PHOTO' }),
      );
      expect(ticket.uploadUrl).toContain(
        `fake://private/pending/users/${OTHER_USER_ID}/profile-photo/${FILE_ID}.jpg`,
      );
    });

    it('should refuse a profile photo upload that names no person', async () => {
      await expect(
        service.requestUpload(
          user,
          buildInput({ purpose: 'PROFILE_PHOTO', contentType: 'image/jpeg' }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
      expect(create).not.toHaveBeenCalled();
    });

    it('should refuse a profile photo for someone who is not a member of the institute', async () => {
      isMember.mockResolvedValue(false);

      await expect(
        service.requestUpload(
          user,
          buildInput({
            purpose: 'PROFILE_PHOTO',
            contentType: 'image/jpeg',
            subjectUserId: OTHER_USER_ID,
          }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(create).not.toHaveBeenCalled();
    });

    it('should ignore a named person for a file that belongs to the institute', async () => {
      await service.requestUpload(user, buildInput({ subjectUserId: OTHER_USER_ID }));

      expect(create).toHaveBeenCalledWith(expect.objectContaining({ subjectUserId: null }));
      expect(isMember).not.toHaveBeenCalled();
    });

    it("should store a reseller's logo under the reseller, in a public purpose", async () => {
      const ticket = await service.requestUpload(
        resellerUser,
        buildInput({ purpose: 'RESELLER_LOGO', fileName: 'logo.png', contentType: 'image/png' }),
      );

      expect(ticket.uploadUrl).toContain(
        `pending/resellers/${RESELLER_ID}/reseller-logo/${FILE_ID}.png`,
      );
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'RESELLER_LOGO', visibility: 'PUBLIC' }),
      );
      expect(can).toHaveBeenCalledWith('update', 'Reseller');
    });

    it('should refuse reseller branding from an institute, whatever its abilities', async () => {
      await expect(
        service.requestUpload(
          user,
          buildInput({ purpose: 'RESELLER_LOGO', fileName: 'logo.png', contentType: 'image/png' }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(create).not.toHaveBeenCalled();
    });

    it('should refuse an institute purpose from a reseller, whatever its abilities', async () => {
      await expect(service.requestUpload(resellerUser, buildInput())).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
      expect(create).not.toHaveBeenCalled();
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
    it('should move a matching upload to its final key and remove the pending object', async () => {
      findClaimable.mockResolvedValue([buildFile()]);
      storage.simulateUpload('private', PENDING_KEY, PDF, 'application/pdf');

      await expect(service.verifyUploads([FILE_ID], 'LEAVE_ATTACHMENT')).resolves.toBeUndefined();

      expect(markRejected).not.toHaveBeenCalled();
      expect((await storage.get('private', KEY)).equals(PDF)).toBe(true);
      expect(storage.has('private', PENDING_KEY)).toBe(false);
    });

    it('should not let a later write through the upload URL change the verified file', async () => {
      findClaimable.mockResolvedValue([buildFile()]);
      storage.simulateUpload('private', PENDING_KEY, PDF, 'application/pdf');
      await service.verifyUploads([FILE_ID], 'LEAVE_ATTACHMENT');

      const replaced = Buffer.from('MZ executable!');
      storage.simulateUpload('private', PENDING_KEY, replaced, 'application/pdf');

      expect((await storage.get('private', KEY)).equals(PDF)).toBe(true);
    });

    it('should pass again when retried after the copy already happened', async () => {
      findClaimable.mockResolvedValue([buildFile()]);
      storage.simulateUpload('private', PENDING_KEY, PDF, 'application/pdf');
      await service.verifyUploads([FILE_ID], 'LEAVE_ATTACHMENT');

      await expect(service.verifyUploads([FILE_ID], 'LEAVE_ATTACHMENT')).resolves.toBeUndefined();
    });

    it('should move a public-purpose upload from the private pending key to the public bucket', async () => {
      findClaimable.mockResolvedValue([buildFile({ visibility: 'PUBLIC' })]);
      storage.simulateUpload('private', PENDING_KEY, PDF, 'application/pdf');

      await service.verifyUploads([FILE_ID], 'LEAVE_ATTACHMENT');

      expect(storage.has('public', KEY)).toBe(true);
      expect(storage.has('private', KEY)).toBe(false);
    });

    it('should look each id up once when it is given twice', async () => {
      findClaimable.mockResolvedValue([buildFile()]);
      storage.simulateUpload('private', PENDING_KEY, PDF, 'application/pdf');

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
      storage.simulateUpload('private', PENDING_KEY, exe, 'application/pdf');

      await expect(service.verifyUploads([FILE_ID], 'LEAVE_ATTACHMENT')).rejects.toMatchObject({
        code: ErrorCode.FILE_CONTENT_MISMATCH,
      });
      expect(markRejected).toHaveBeenCalledWith(FILE_ID);
      expect(storage.has('private', KEY)).toBe(false);
      expect(storage.has('private', PENDING_KEY)).toBe(false);
    });

    it('should reject an object whose size differs from the declared size', async () => {
      findClaimable.mockResolvedValue([buildFile({ sizeBytes: PDF.length + 1 })]);
      storage.simulateUpload('private', PENDING_KEY, PDF, 'application/pdf');

      await expect(service.verifyUploads([FILE_ID], 'LEAVE_ATTACHMENT')).rejects.toMatchObject({
        code: ErrorCode.FILE_CONTENT_MISMATCH,
      });
    });

    it('should do nothing for an empty list', async () => {
      await service.verifyUploads([], 'LEAVE_ATTACHMENT');

      expect(findClaimable).not.toHaveBeenCalled();
    });
  });

  describe('claimUploads', () => {
    it('should verify the upload and then make it ready', async () => {
      findClaimable.mockResolvedValue([buildFile()]);
      storage.simulateUpload('private', PENDING_KEY, PDF, 'application/pdf');

      await service.claimUploads([FILE_ID], 'LEAVE_ATTACHMENT');

      expect(storage.has('private', KEY)).toBe(true);
      expect(markReady).toHaveBeenCalledWith([FILE_ID], 'LEAVE_ATTACHMENT');
    });

    it('should not make a file ready when its content fails verification', async () => {
      findClaimable.mockResolvedValue([buildFile()]);
      storage.simulateUpload(
        'private',
        PENDING_KEY,
        Buffer.from('MZ not a pdf'),
        'application/pdf',
      );

      await expect(service.claimUploads([FILE_ID], 'LEAVE_ATTACHMENT')).rejects.toMatchObject({
        code: ErrorCode.FILE_CONTENT_MISMATCH,
      });
      expect(markReady).not.toHaveBeenCalled();
    });
  });

  describe('verifyUploads for images', () => {
    it('should store only the processed sizes, as WebP, and drop the original', async () => {
      findClaimable.mockResolvedValue([buildImage()]);
      storage.simulateUpload('private', `pending/${IMAGE_KEY}`, PHOTO, 'image/jpeg');

      await service.verifyUploads([FILE_ID], 'LEAVE_ATTACHMENT');

      expect(images.process).toHaveBeenCalledWith(PHOTO, {
        square: false,
        fullPx: 2560,
        cacheableThumbnails: false,
      });
      expect((await storage.get('private', `${IMAGE_BASE}/sm.webp`)).toString()).toBe('sm');
      expect((await storage.get('private', `${IMAGE_BASE}/md.webp`)).toString()).toBe('medium');
      expect((await storage.get('private', `${IMAGE_BASE}/full.webp`)).toString()).toBe(
        'full-size',
      );
      expect(await storage.head('private', `${IMAGE_BASE}/sm.webp`)).toEqual({
        size: 2,
        contentType: 'image/webp',
      });
      expect(storage.has('private', `pending/${IMAGE_KEY}`)).toBe(false);
      expect(storage.has('private', IMAGE_KEY)).toBe(false);
    });

    it('should record the sizes, placeholder and total bytes of the image', async () => {
      findClaimable.mockResolvedValue([buildImage()]);
      storage.simulateUpload('private', `pending/${IMAGE_KEY}`, PHOTO, 'image/jpeg');

      await service.verifyUploads([FILE_ID], 'LEAVE_ATTACHMENT');

      expect(saveProcessedImage).toHaveBeenCalledWith(FILE_ID, {
        width: 2000,
        height: 1500,
        placeholder: 'data:image/webp;base64,AAAA',
        variants: [
          { name: 'SM', width: 128, height: 96, sizeBytes: 2 },
          { name: 'MD', width: 512, height: 384, sizeBytes: 6 },
          { name: 'FULL', width: 2000, height: 1500, sizeBytes: 9 },
        ],
        sizeBytes: 17,
      });
    });

    it('should reject an image the processor cannot read and leave nothing stored', async () => {
      findClaimable.mockResolvedValue([buildImage()]);
      storage.simulateUpload('private', `pending/${IMAGE_KEY}`, PHOTO, 'image/jpeg');
      images.process.mockRejectedValue(new InvalidImageError('too many pixels'));

      await expect(service.verifyUploads([FILE_ID], 'LEAVE_ATTACHMENT')).rejects.toMatchObject({
        code: ErrorCode.FILE_IMAGE_INVALID,
      });

      expect(markRejected).toHaveBeenCalledWith(FILE_ID);
      expect(storage.has('private', `pending/${IMAGE_KEY}`)).toBe(false);
      expect(storage.has('private', `${IMAGE_BASE}/full.webp`)).toBe(false);
      expect(saveProcessedImage).not.toHaveBeenCalled();
    });

    it('should reject an image whose uploaded size differs from the declared size', async () => {
      findClaimable.mockResolvedValue([buildImage({ sizeBytes: PHOTO.length + 5 })]);
      storage.simulateUpload('private', `pending/${IMAGE_KEY}`, PHOTO, 'image/jpeg');

      await expect(service.verifyUploads([FILE_ID], 'LEAVE_ATTACHMENT')).rejects.toMatchObject({
        code: ErrorCode.FILE_CONTENT_MISMATCH,
      });
      expect(images.process).not.toHaveBeenCalled();
    });

    it('should reject an image that was never uploaded', async () => {
      findClaimable.mockResolvedValue([buildImage()]);

      await expect(service.verifyUploads([FILE_ID], 'LEAVE_ATTACHMENT')).rejects.toMatchObject({
        code: ErrorCode.FILE_CONTENT_MISMATCH,
      });
    });

    it('should pass without processing again when retried after the sizes were stored', async () => {
      findClaimable.mockResolvedValue([buildStoredImage({ status: 'PENDING' })]);
      await storage.put('private', `${IMAGE_BASE}/full.webp`, Buffer.from('full-size'), {
        contentType: 'image/webp',
      });

      await expect(service.verifyUploads([FILE_ID], 'LEAVE_ATTACHMENT')).resolves.toBeUndefined();
      expect(images.process).not.toHaveBeenCalled();
    });

    it('should not let a later write through the upload URL change the stored image', async () => {
      findClaimable.mockResolvedValue([buildImage()]);
      storage.simulateUpload('private', `pending/${IMAGE_KEY}`, PHOTO, 'image/jpeg');
      await service.verifyUploads([FILE_ID], 'LEAVE_ATTACHMENT');

      storage.simulateUpload(
        'private',
        `pending/${IMAGE_KEY}`,
        Buffer.from('swapped'),
        'image/jpeg',
      );

      expect((await storage.get('private', `${IMAGE_BASE}/full.webp`)).toString()).toBe(
        'full-size',
      );
    });
  });

  describe('refUrl', () => {
    const leaveAttachmentPolicy = FILE_PURPOSE_POLICY.LEAVE_ATTACHMENT;

    afterEach(() => {
      vi.useRealTimers();
      Object.assign(FILE_PURPOSE_POLICY, { LEAVE_ATTACHMENT: leaveAttachmentPolicy });
    });

    it('should sign a private file for the normal download lifetime', async () => {
      const url = await service.refUrl(buildFile({ status: 'READY' }), 'FULL');

      expect(url).toBe(`fake://private/${KEY}?get&expires=${DOWNLOAD_URL_TTL_SECONDS}&at=now`);
    });

    it('should ignore the size argument for a file that is not an image', async () => {
      const url = await service.refUrl(buildFile({ status: 'READY' }), 'SM');

      expect(url).toBe(`fake://private/${KEY}?get&expires=${DOWNLOAD_URL_TTL_SECONDS}&at=now`);
    });

    it('should give a public file its stable URL', async () => {
      const url = await service.refUrl(
        buildFile({ status: 'READY', visibility: 'PUBLIC' }),
        'FULL',
      );

      expect(url).toBe(`fake://public/${KEY}`);
    });

    it('should serve the FULL size of an image with a short-lived link', async () => {
      const url = await service.refUrl(buildStoredImage(), 'FULL');

      expect(url).toBe(
        `fake://private/${IMAGE_BASE}/full.webp?get&expires=${DOWNLOAD_URL_TTL_SECONDS}&at=now`,
      );
    });

    it('should keep thumbnail links of document scans short-lived', async () => {
      const url = await service.refUrl(buildStoredImage(), 'SM');

      expect(url).toBe(
        `fake://private/${IMAGE_BASE}/sm.webp?get&expires=${DOWNLOAD_URL_TTL_SECONDS}&at=now`,
      );
    });

    it('should give the same thumbnail link to every request in one window when the purpose allows caching', async () => {
      // No purpose opts in yet, so one is switched on for this test and restored after it.
      Object.assign(FILE_PURPOSE_POLICY, {
        LEAVE_ATTACHMENT: {
          ...leaveAttachmentPolicy,
          image: { square: true, fullPx: 1600, cacheableThumbnails: true },
        },
      });
      const windowMs = THUMBNAIL_URL_WINDOW_SECONDS * 1000;
      const windowStart = Math.floor(Date.UTC(2026, 10, 19, 14, 30) / windowMs) * windowMs;
      vi.useFakeTimers();

      vi.setSystemTime(windowStart + 1000);
      const early = await service.refUrl(buildStoredImage(), 'SM');
      vi.setSystemTime(windowStart + windowMs - 1000);
      const late = await service.refUrl(buildStoredImage(), 'SM');
      vi.setSystemTime(windowStart + windowMs);
      const nextWindow = await service.refUrl(buildStoredImage(), 'SM');

      expect(early).toBe(
        `fake://private/${IMAGE_BASE}/sm.webp?get&expires=${THUMBNAIL_URL_TTL_SECONDS}&at=${windowStart}`,
      );
      expect(late).toBe(early);
      expect(nextWindow).not.toBe(early);
    });

    it('should give profile photos cacheable thumbnail links', async () => {
      const photo = buildStoredImage({ purpose: 'PROFILE_PHOTO' });

      const url = await service.refUrl(photo, 'SM');

      expect(url).toContain(`expires=${THUMBNAIL_URL_TTL_SECONDS}`);
    });

    it('should mark stored private images cacheable by the browser only, public ones by anyone', async () => {
      const put = vi.spyOn(storage, 'put');
      findClaimable.mockResolvedValue([buildImage()]);
      storage.simulateUpload('private', `pending/${IMAGE_KEY}`, PHOTO, 'image/jpeg');
      await service.verifyUploads([FILE_ID], 'LEAVE_ATTACHMENT');

      findClaimable.mockResolvedValue([buildImage({ visibility: 'PUBLIC' })]);
      storage.simulateUpload('private', `pending/${IMAGE_KEY}`, PHOTO, 'image/jpeg');
      await service.verifyUploads([FILE_ID], 'LEAVE_ATTACHMENT');

      expect(put.mock.calls.map(([bucket, , , options]) => [bucket, options.cacheControl])).toEqual(
        [
          ['private', `private, max-age=${THUMBNAIL_URL_TTL_SECONDS}, immutable`],
          ['private', `private, max-age=${THUMBNAIL_URL_TTL_SECONDS}, immutable`],
          ['private', `private, max-age=${THUMBNAIL_URL_TTL_SECONDS}, immutable`],
          ['public', 'public, max-age=31536000, immutable'],
          ['public', 'public, max-age=31536000, immutable'],
          ['public', 'public, max-age=31536000, immutable'],
        ],
      );
    });

    it('should give a public image a stable URL per size', async () => {
      const image = buildStoredImage({ visibility: 'PUBLIC' });

      expect(await service.refUrl(image, 'MD')).toBe(`fake://public/${IMAGE_BASE}/md.webp`);
    });
  });

  describe('downloadUrl', () => {
    it('should return a short-lived URL for a ready file the user may read', async () => {
      findById.mockResolvedValue(buildFile({ status: 'READY' }));

      const url = await service.downloadUrl(user, FILE_ID);

      expect(url).toBe(
        `fake://private/${KEY}?get&expires=${AUDITED_DOWNLOAD_URL_TTL_SECONDS}&at=now`,
      );
      expect(can).toHaveBeenCalledWith(
        'read',
        subject('Leave', { id: LEAVE_ID, tenantId: TENANT_ID, userId: USER_ID }),
      );
    });

    it("should refuse another person's leave attachment to a user who may read only own leaves", async () => {
      findById.mockResolvedValue(buildFile({ status: 'READY' }));
      findLeaveForFile.mockResolvedValue({
        id: LEAVE_ID,
        tenantId: TENANT_ID,
        userId: OTHER_USER_ID,
      });
      createForUser.mockResolvedValue(
        createMongoAbility<AppAbility>([
          { action: 'read', subject: 'Leave', conditions: { userId: USER_ID } },
        ]),
      );

      await expect(service.downloadUrl(user, FILE_ID)).rejects.toMatchObject({
        code: ErrorCode.FILE_NOT_FOUND,
      });
    });

    it('should allow the own leave attachment to a user who may read only own leaves', async () => {
      findById.mockResolvedValue(buildFile({ status: 'READY' }));
      createForUser.mockResolvedValue(
        createMongoAbility<AppAbility>([
          { action: 'read', subject: 'Leave', conditions: { userId: USER_ID } },
        ]),
      );

      await expect(service.downloadUrl(user, FILE_ID)).resolves.toContain(KEY);
    });

    it('should answer not found for a leave file that is no longer attached to a leave', async () => {
      findById.mockResolvedValue(buildFile({ status: 'READY' }));
      findLeaveForFile.mockResolvedValue(null);

      await expect(service.downloadUrl(user, FILE_ID)).rejects.toMatchObject({
        code: ErrorCode.FILE_NOT_FOUND,
      });
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

  describe('downloadUrl for a user document', () => {
    const documentFile = () =>
      buildFile({
        status: 'READY',
        purpose: 'USER_DOCUMENT',
        tenantId: null,
        subjectUserId: OTHER_USER_ID,
        objectKey: DOCUMENT_KEY,
      });

    it('should return a short-lived URL when the document belongs to a student the user may read', async () => {
      findById.mockResolvedValue(documentFile());
      const ability = createMock<AppAbility>({ can });
      createForUser.mockResolvedValue(ability);

      const url = await service.downloadUrl(user, FILE_ID);

      expect(url).toBe(
        `fake://private/${DOCUMENT_KEY}?get&expires=${AUDITED_DOWNLOAD_URL_TTL_SECONDS}&at=now`,
      );
      expect(findStudentDocumentForFile).toHaveBeenCalledWith(FILE_ID, ability);
    });

    it('should answer not found when no readable student of this institute owns the document', async () => {
      findById.mockResolvedValue(documentFile());
      findStudentDocumentForFile.mockResolvedValue(null);

      await expect(service.downloadUrl(user, FILE_ID)).rejects.toMatchObject({
        code: ErrorCode.FILE_NOT_FOUND,
      });
    });

    it('should refuse an Aadhaar scan to a user who may not read the Aadhaar field', async () => {
      findById.mockResolvedValue(documentFile());
      findStudentDocumentForFile.mockResolvedValue({ id: DOCUMENT_ID, type: 'AADHAAR_CARD' });
      createForUser.mockResolvedValue(
        createMongoAbility<AppAbility>([
          { action: 'read', subject: 'Student', fields: ['id', 'admissionNumber'] },
        ]),
      );

      await expect(service.downloadUrl(user, FILE_ID)).rejects.toMatchObject({
        code: ErrorCode.FILE_NOT_FOUND,
      });
    });

    it('should allow an Aadhaar scan to a user who may read every student field', async () => {
      findById.mockResolvedValue(documentFile());
      findStudentDocumentForFile.mockResolvedValue({ id: DOCUMENT_ID, type: 'AADHAAR_CARD' });
      createForUser.mockResolvedValue(
        createMongoAbility<AppAbility>([{ action: 'read', subject: 'Student' }]),
      );

      await expect(service.downloadUrl(user, FILE_ID)).resolves.toContain(DOCUMENT_KEY);
    });
  });

  describe('downloadUrl for an application document', () => {
    const APPLICATION_KEY = `institutes/${TENANT_ID}/application-document/${FILE_ID}.pdf`;
    const pageFile = () =>
      buildFile({ status: 'READY', purpose: 'APPLICATION_DOCUMENT', objectKey: APPLICATION_KEY });

    it('should return a short-lived URL when the page belongs to an application the user may read', async () => {
      findById.mockResolvedValue(pageFile());
      const ability = createMock<AppAbility>({ can });
      createForUser.mockResolvedValue(ability);

      const url = await service.downloadUrl(user, FILE_ID);

      expect(url).toBe(
        `fake://private/${APPLICATION_KEY}?get&expires=${AUDITED_DOWNLOAD_URL_TTL_SECONDS}&at=now`,
      );
      expect(findApplicationDocumentForFile).toHaveBeenCalledWith(FILE_ID, ability);
    });

    it('should answer not found when no readable application owns the page', async () => {
      findById.mockResolvedValue(pageFile());
      findApplicationDocumentForFile.mockResolvedValue(null);

      await expect(service.downloadUrl(user, FILE_ID)).rejects.toMatchObject({
        code: ErrorCode.FILE_NOT_FOUND,
      });
    });

    it('should refuse an Aadhaar scan to a user who may not read the Aadhaar field', async () => {
      findById.mockResolvedValue(pageFile());
      findApplicationDocumentForFile.mockResolvedValue({ id: DOCUMENT_ID, type: 'AADHAAR_CARD' });
      createForUser.mockResolvedValue(
        createMongoAbility<AppAbility>([
          { action: 'read', subject: 'Application' },
          { action: 'read', subject: 'Student', fields: ['id', 'admissionNumber'] },
        ]),
      );

      await expect(service.downloadUrl(user, FILE_ID)).rejects.toMatchObject({
        code: ErrorCode.FILE_NOT_FOUND,
      });
    });

    it('should never put a link to a page in an ordinary response', async () => {
      await expect(service.refUrl(pageFile(), 'FULL')).resolves.toBeNull();
    });
  });

  describe('signedDownloadUrl', () => {
    it('should sign a 60-second link without consulting abilities', async () => {
      const url = await service.signedDownloadUrl(buildFile({ status: 'READY' }));

      expect(url).toBe(
        `fake://private/${KEY}?get&expires=${AUDITED_DOWNLOAD_URL_TTL_SECONDS}&at=now`,
      );
      expect(createForUser).not.toHaveBeenCalled();
    });
  });
});
