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
  type FileContentType,
  type FilePurpose,
  fileContentMatchesType,
  fileExtensionFor,
  type InstituteContext,
  isFileContentType,
} from '@roviq/common-types';
import { type StorageBucket, StorageClient } from '@roviq/storage';
import type { RequestFileUploadInput } from './dto/request-file-upload.input';
import type { FileRefModel } from './models/file-ref.model';
import type { FileUploadTicket } from './models/file-upload-ticket.model';
import { FileRepository } from './repositories/file.repository';
import type { FileRecord } from './repositories/types';

export const UPLOAD_URL_TTL_SECONDS = 5 * 60;
export const DOWNLOAD_URL_TTL_SECONDS = 10 * 60;
export const AUDITED_DOWNLOAD_URL_TTL_SECONDS = 60;
/** Uploads a user may have started and not yet attached; stops storage being filled unnoticed. */
export const MAX_PENDING_UPLOADS_PER_USER = 20;

const INLINE_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp']);

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
  ) {}

  async requestUpload(
    user: InstituteContext,
    input: RequestFileUploadInput,
  ): Promise<FileUploadTicket> {
    const policy = FILE_PURPOSE_POLICY[input.purpose];
    const ability = await this.abilities.createForUser(user);
    if (
      !policy.uploadAbility ||
      !ability.can(policy.uploadAbility.action, policy.uploadAbility.subject)
    ) {
      throw new BusinessException(ErrorCode.FORBIDDEN, 'You are not allowed to upload this file.');
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
      visibility: policy.visibility,
      purpose: input.purpose,
      objectKey: (id) => this.objectKey(user.tenantId, input.purpose, id, contentType),
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
      if (!(await this.acceptUpload(file))) {
        await this.repo.markRejected(file.id);
        await this.storage.delete(bucketOf(file), [file.objectKey]);
        throw new BusinessException(
          ErrorCode.FILE_CONTENT_MISMATCH,
          `The uploaded file "${file.originalName}" is missing or does not match its type.`,
        );
      }
    }
  }

  async toRef(file: FileRecord): Promise<FileRefModel> {
    return {
      id: file.id,
      name: file.originalName,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      url: FILE_PURPOSE_POLICY[file.purpose].sensitive
        ? null
        : await this.urlFor(file, DOWNLOAD_URL_TTL_SECONDS),
    };
  }

  toRefs(records: FileRecord[]): Promise<FileRefModel[]> {
    return Promise.all(records.map((file) => this.toRef(file)));
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
    return this.urlFor(file, AUDITED_DOWNLOAD_URL_TTL_SECONDS);
  }

  /**
   * Checks the ability against the record the file is attached to, not only the subject type:
   * a rule such as "read own leaves" must not open every leave attachment in the institute.
   */
  private async canRead(ability: AppAbility, file: FileRecord): Promise<boolean> {
    const { readAbility } = FILE_PURPOSE_POLICY[file.purpose];
    if (file.purpose === 'LEAVE_ATTACHMENT') {
      const leave = await this.repo.findLeaveForFile(file.id);
      return leave !== null && ability.can(readAbility.action, subject('Leave', leave));
    }
    return ability.can(readAbility.action, readAbility.subject);
  }

  private urlFor(file: FileRecord, expiresInSeconds: number): Promise<string> {
    if (file.visibility === 'PUBLIC') {
      return Promise.resolve(this.storage.publicUrl(file.objectKey));
    }
    return this.storage.presignGet('private', file.objectKey, {
      expiresInSeconds,
      disposition: {
        type: INLINE_TYPES.has(file.contentType) ? 'inline' : 'attachment',
        filename: file.originalName,
      },
    });
  }

  /**
   * Moves the upload to the key it will be served from, then checks that copy. The checked
   * object cannot be replaced afterwards, because no upload URL was ever issued for its key.
   */
  private async acceptUpload(file: FileRecord): Promise<boolean> {
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
    if (!stored || stored.size !== file.sizeBytes) return false;
    if (!isFileContentType(file.contentType)) return false;
    const head = await this.storage.getRange(
      bucket,
      file.objectKey,
      0,
      Math.min(stored.size, FILE_SIGNATURE_BYTES) - 1,
    );
    const matches = fileContentMatchesType(head, file.contentType);
    if (!matches) {
      this.logger.warn(`File ${file.id} content does not match ${file.contentType}`);
    }
    return matches;
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
    tenantId: string,
    purpose: FilePurpose,
    fileId: string,
    contentType: FileContentType,
  ): string {
    const folder = purpose.toLowerCase().replaceAll('_', '-');
    return `institutes/${tenantId}/${folder}/${fileId}.${fileExtensionFor(contentType)}`;
  }
}
