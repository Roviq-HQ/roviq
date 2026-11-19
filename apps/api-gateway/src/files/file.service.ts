import { subject } from '@casl/ability';
import { Injectable, Logger } from '@nestjs/common';
import { AbilityFactory } from '@roviq/casl';
import {
  type AppAbility,
  type AuthUser,
  BusinessException,
  ErrorCode,
  FILE_PURPOSE_POLICY,
  FILE_SIGNATURE_BYTES,
  type FileAbility,
  type FileContentType,
  type FilePurpose,
  fileContentMatchesType,
  fileExtensionFor,
  type ImageVariant,
  type InstituteContext,
  isFileContentType,
  isImageContentType,
  type ResellerContext,
} from '@roviq/common-types';
import { type StorageBucket, StorageClient } from '@roviq/storage';
import type { RequestFileUploadInput } from './dto/request-file-upload.input';
import { ImageProcessor, InvalidImageError } from './image/image-processor';
import type { FileUploadTicket } from './models/file-upload-ticket.model';
import { FileRepository } from './repositories/file.repository';
import type { FileRecord } from './repositories/types';

export const UPLOAD_URL_TTL_SECONDS = 5 * 60;
export const DOWNLOAD_URL_TTL_SECONDS = 10 * 60;
export const AUDITED_DOWNLOAD_URL_TTL_SECONDS = 60;
/** Uploads a user may have started and not yet attached; stops storage being filled unnoticed. */
export const MAX_PENDING_UPLOADS_PER_USER = 20;
/**
 * Where a purpose allows it (`cacheableThumbnails`), thumbnail links are signed at the start of
 * a fixed window, so every request in that window gets the same URL and the browser cache hits.
 * The cost: a leaked thumbnail link works for up to THUMBNAIL_URL_TTL_SECONDS, not ten minutes.
 */
export const THUMBNAIL_URL_WINDOW_SECONDS = 6 * 60 * 60;
export const THUMBNAIL_URL_TTL_SECONDS = 12 * 60 * 60;
/** Objects never change once written: a new upload is a new file id and key. */
const PUBLIC_CACHE_CONTROL = 'public, max-age=31536000, immutable';
/** Private objects: the user's own browser only, and no longer than a link to them can live. */
const PRIVATE_CACHE_CONTROL = `private, max-age=${THUMBNAIL_URL_TTL_SECONDS}, immutable`;

type UploadVerdict = 'ACCEPTED' | 'CONTENT_MISMATCH' | 'IMAGE_INVALID';

function bucketOf(file: Pick<FileRecord, 'visibility'>): StorageBucket {
  return file.visibility === 'PUBLIC' ? 'public' : 'private';
}

/**
 * Where the browser uploads to. Always in the private bucket, and never the key a file is
 * served from: the upload URL stays valid for minutes, so the object behind it can still
 * change after it was checked.
 */
function pendingKeyOf(file: Pick<FileRecord, 'objectKey'>): string {
  return `pending/${file.objectKey}`;
}

/** Key of one stored size of an image: `…/{fileId}/sm.webp`. */
function variantKeyOf(file: Pick<FileRecord, 'objectKey'>, variant: ImageVariant): string {
  return `${file.objectKey.replace(/\.[a-z0-9]+$/, '')}/${variant.toLowerCase()}.webp`;
}

/** Every key a file may occupy in its own bucket, for cleanup. */
function storedKeysOf(file: Pick<FileRecord, 'objectKey'>): string[] {
  return [
    file.objectKey,
    variantKeyOf(file, 'SM'),
    variantKeyOf(file, 'MD'),
    variantKeyOf(file, 'FULL'),
  ];
}

/** First part of the storage key: who owns the file. Never taken from the request body. */
function ownerPrefix(user: InstituteContext | ResellerContext, subjectUserId: string | null) {
  if (subjectUserId) return `users/${subjectUserId}`;
  return user.scope === 'reseller' ? `resellers/${user.resellerId}` : `institutes/${user.tenantId}`;
}

function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is being removed
  return base.replace(/[\u0000-\u001f\u007f]/g, '').trim() || 'file';
}

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  constructor(
    private readonly repo: FileRepository,
    private readonly storage: StorageClient,
    private readonly abilities: AbilityFactory,
    private readonly images: ImageProcessor,
  ) {}

  async requestUpload(
    user: InstituteContext | ResellerContext,
    input: RequestFileUploadInput,
  ): Promise<FileUploadTicket> {
    const policy = FILE_PURPOSE_POLICY[input.purpose];
    const ability = await this.abilities.createForUser(user);
    // A purpose is uploaded from one portal only: a reseller's branding never from an institute.
    const ownScope = (policy.owner === 'RESELLER') === (user.scope === 'reseller');
    if (!ownScope || !policy.uploadAbility || !this.allows(ability, policy.uploadAbility)) {
      throw new BusinessException(ErrorCode.FORBIDDEN, 'You are not allowed to upload this file.');
    }
    const subjectUserId = policy.owner === 'USER' ? (input.subjectUserId ?? null) : null;
    if (policy.owner === 'USER' && !subjectUserId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'subjectUserId is required for this kind of file.',
      );
    }
    // RLS refuses this insert as well; checking first gives a clear answer, not a server error.
    if (subjectUserId && !(await this.repo.isMemberOfCurrentTenant(subjectUserId))) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        'This person is not a member of your institute.',
      );
    }
    const contentType = this.assertAllowedType(input.purpose, input.contentType);
    if (input.sizeBytes > policy.maxSizeBytes) {
      throw new BusinessException(ErrorCode.FILE_TOO_LARGE, 'The file is too large.');
    }
    if ((await this.repo.countPendingByCurrentUser()) >= MAX_PENDING_UPLOADS_PER_USER) {
      throw new BusinessException(
        ErrorCode.FILE_UPLOAD_LIMIT_REACHED,
        'Too many unfinished uploads. Try again later.',
      );
    }

    const file = await this.repo.create({
      subjectUserId,
      visibility: policy.visibility,
      purpose: input.purpose,
      objectKey: (id) =>
        this.objectKey(ownerPrefix(user, subjectUserId), input.purpose, id, contentType),
      originalName: cleanFileName(input.fileName),
      contentType,
      sizeBytes: input.sizeBytes,
      status: 'PENDING',
    });

    const presigned = await this.storage.presignPut('private', pendingKeyOf(file), {
      contentType,
      contentLength: input.sizeBytes,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    });
    return {
      fileId: file.id,
      uploadUrl: presigned.url,
      headers: Object.entries(presigned.headers).map(([name, value]) => ({ name, value })),
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000),
    };
  }

  /**
   * Checks that each upload exists in storage with the declared size and content. The caller
   * then attaches them with `markFilesReady` inside the transaction that saves its record.
   */
  async verifyUploads(fileIds: string[], purpose: FilePurpose): Promise<void> {
    if (fileIds.length === 0) return;
    const unique = [...new Set(fileIds)];
    const claimable = await this.repo.findClaimable(unique, purpose);
    if (claimable.length !== unique.length) {
      throw new BusinessException(
        ErrorCode.FILE_NOT_FOUND,
        'One or more files are missing or cannot be attached.',
      );
    }
    for (const file of claimable) {
      const verdict = await this.acceptUpload(file);
      if (verdict === 'ACCEPTED') continue;
      await this.repo.markRejected(file.id);
      await this.storage.delete('private', [pendingKeyOf(file)]);
      await this.storage.delete(bucketOf(file), storedKeysOf(file));
      throw verdict === 'IMAGE_INVALID'
        ? new BusinessException(
            ErrorCode.FILE_IMAGE_INVALID,
            `The image "${file.originalName}" could not be read or has too many pixels.`,
          )
        : new BusinessException(
            ErrorCode.FILE_CONTENT_MISMATCH,
            `The uploaded file "${file.originalName}" is missing or does not match its type.`,
          );
    }
  }

  /**
   * Link shown in ordinary responses. Null for sensitive files, which are downloaded through
   * `downloadUrl` instead. `variant` picks the size of an image and is ignored for other files.
   */
  refUrl(file: FileRecord, variant: ImageVariant): Promise<string | null> {
    if (FILE_PURPOSE_POLICY[file.purpose].sensitive) return Promise.resolve(null);
    return this.urlFor(file, variant, DOWNLOAD_URL_TTL_SECONDS);
  }

  /**
   * Short-lived URL for a file the caller has already been allowed to read by its own checks
   * (platform screens, which have no institute ability to test).
   */
  signedDownloadUrl(file: FileRecord): Promise<string> {
    return this.urlFor(file, 'FULL', AUDITED_DOWNLOAD_URL_TTL_SECONDS);
  }

  /** Short-lived URL for one file, checked against the ability its purpose requires. */
  async downloadUrl(user: AuthUser, fileId: string): Promise<string> {
    const file = await this.repo.findById(fileId);
    if (!file || file.status !== 'READY') {
      throw new BusinessException(ErrorCode.FILE_NOT_FOUND, 'File not found.');
    }
    const ability = await this.abilities.createForUser(user);
    if (!(await this.canRead(ability, file))) {
      // Same answer as a missing file, so ids cannot be probed.
      throw new BusinessException(ErrorCode.FILE_NOT_FOUND, 'File not found.');
    }
    return this.urlFor(file, 'FULL', AUDITED_DOWNLOAD_URL_TTL_SECONDS);
  }

  /**
   * Checks the ability against the record the file is attached to, not only the subject type:
   * a rule such as "read own leaves" must not open every leave attachment in the institute.
   */
  private async canRead(ability: AppAbility, file: FileRecord): Promise<boolean> {
    const { readAbility } = FILE_PURPOSE_POLICY[file.purpose];
    if (file.purpose === 'LEAVE_ATTACHMENT') {
      const leave = await this.repo.findLeaveForFile(file.id);
      return (
        leave !== null &&
        readAbility !== 'AUTHENTICATED' &&
        ability.can(readAbility.action, subject('Leave', leave))
      );
    }
    if (file.purpose === 'USER_DOCUMENT') {
      const document = await this.repo.findStudentDocumentForFile(file.id, ability);
      if (!document) return false;
      // Same field rule as the document list: the scan shows the Aadhaar number itself.
      return document.type !== 'AADHAAR_CARD' || ability.can('read', 'Student', 'aadhaar');
    }
    return this.allows(ability, readAbility);
  }

  private allows(ability: AppAbility, required: FileAbility): boolean {
    return required === 'AUTHENTICATED' || ability.can(required.action, required.subject);
  }

  private urlFor(
    file: FileRecord,
    variant: ImageVariant,
    expiresInSeconds: number,
  ): Promise<string> {
    const isImage = file.variants !== null;
    const key = isImage ? variantKeyOf(file, variant) : file.objectKey;
    if (file.visibility === 'PUBLIC') return Promise.resolve(this.storage.publicUrl(key));

    const disposition = {
      type: isImage ? ('inline' as const) : ('attachment' as const),
      filename: isImage ? file.originalName.replace(/\.[^.]*$/, '.webp') : file.originalName,
    };
    const cacheable = FILE_PURPOSE_POLICY[file.purpose].image?.cacheableThumbnails === true;
    if (isImage && variant !== 'FULL' && cacheable) {
      const windowMs = THUMBNAIL_URL_WINDOW_SECONDS * 1000;
      return this.storage.presignGet('private', key, {
        expiresInSeconds: THUMBNAIL_URL_TTL_SECONDS,
        disposition,
        signingDate: new Date(Math.floor(Date.now() / windowMs) * windowMs),
      });
    }
    return this.storage.presignGet('private', key, { expiresInSeconds, disposition });
  }

  /**
   * Moves the upload to the key it will be served from, then checks what was stored there. The
   * checked object cannot be replaced afterwards: no upload URL was ever issued for its key.
   */
  private acceptUpload(file: FileRecord): Promise<UploadVerdict> {
    return isImageContentType(file.contentType) ? this.acceptImage(file) : this.acceptFile(file);
  }

  private async acceptFile(file: FileRecord): Promise<UploadVerdict> {
    const bucket = bucketOf(file);
    const pendingKey = pendingKeyOf(file);
    // No pending object means a retry after the copy already happened; the final key decides.
    if (await this.storage.head('private', pendingKey)) {
      await this.storage.copy(
        { bucket: 'private', key: pendingKey },
        { bucket, key: file.objectKey },
      );
      await this.storage.delete('private', [pendingKey]);
    }
    const stored = await this.storage.head(bucket, file.objectKey);
    if (!stored || stored.size !== file.sizeBytes) return 'CONTENT_MISMATCH';
    if (!isFileContentType(file.contentType)) return 'CONTENT_MISMATCH';
    const head = await this.storage.getRange(
      bucket,
      file.objectKey,
      0,
      Math.min(stored.size, FILE_SIGNATURE_BYTES) - 1,
    );
    if (!fileContentMatchesType(head, file.contentType)) {
      this.logger.warn(`File ${file.id} content does not match ${file.contentType}`);
      return 'CONTENT_MISMATCH';
    }
    return 'ACCEPTED';
  }

  /** An image is never stored as uploaded: only the sizes produced here are kept. */
  private async acceptImage(file: FileRecord): Promise<UploadVerdict> {
    const policy = FILE_PURPOSE_POLICY[file.purpose].image;
    if (!policy) return 'CONTENT_MISMATCH';
    const bucket = bucketOf(file);
    const pendingKey = pendingKeyOf(file);

    const pending = await this.storage.head('private', pendingKey);
    if (!pending) {
      // A retry after processing already ran: the stored sizes decide.
      const done =
        file.variants !== null && (await this.storage.head(bucket, variantKeyOf(file, 'FULL')));
      return done ? 'ACCEPTED' : 'CONTENT_MISMATCH';
    }
    if (pending.size !== file.sizeBytes) return 'CONTENT_MISMATCH';

    const original = await this.storage.get('private', pendingKey);
    let processed: Awaited<ReturnType<ImageProcessor['process']>>;
    try {
      processed = await this.images.process(original, policy);
    } catch (err) {
      if (!(err instanceof InvalidImageError)) throw err;
      this.logger.warn(`Image ${file.id} was refused: ${err.message}`);
      return 'IMAGE_INVALID';
    }

    for (const variant of processed.variants) {
      await this.storage.put(bucket, variantKeyOf(file, variant.name), variant.data, {
        contentType: 'image/webp',
        cacheControl: bucket === 'public' ? PUBLIC_CACHE_CONTROL : PRIVATE_CACHE_CONTROL,
      });
    }
    const full = processed.variants.find((variant) => variant.name === 'FULL');
    if (!full) throw new Error('Image processing produced no FULL size');
    await this.repo.saveProcessedImage(file.id, {
      width: full.width,
      height: full.height,
      placeholder: processed.placeholder,
      variants: processed.variants.map(({ name, data, width, height }) => ({
        name,
        width,
        height,
        sizeBytes: data.length,
      })),
      sizeBytes: processed.variants.reduce((sum, variant) => sum + variant.data.length, 0),
    });
    await this.storage.delete('private', [pendingKey]);
    return 'ACCEPTED';
  }

  private assertAllowedType(purpose: FilePurpose, contentType: string): FileContentType {
    const allowed: readonly string[] = FILE_PURPOSE_POLICY[purpose].allowedContentTypes;
    if (!isFileContentType(contentType) || !allowed.includes(contentType)) {
      throw new BusinessException(
        ErrorCode.FILE_TYPE_NOT_ALLOWED,
        'This file type is not accepted here.',
      );
    }
    return contentType;
  }

  private objectKey(
    ownerPrefix: string,
    purpose: FilePurpose,
    fileId: string,
    contentType: FileContentType,
  ): string {
    const folder = purpose.toLowerCase().replaceAll('_', '-');
    return `${ownerPrefix}/${folder}/${fileId}.${fileExtensionFor(contentType)}`;
  }
}
