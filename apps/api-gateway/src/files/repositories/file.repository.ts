import type { AppAbility, FilePurpose } from '@roviq/common-types';
import type {
  CreateFileData,
  FileDocumentOwner,
  FileLeaveOwner,
  FileRecord,
  ProcessedImageData,
} from './types';

/** Institute-scoped access to `files`. Tenant and actor come from the request context. */
export abstract class FileRepository {
  abstract create(data: CreateFileData): Promise<FileRecord>;
  abstract findById(id: string): Promise<FileRecord | null>;
  abstract findByIds(ids: string[]): Promise<FileRecord[]>;
  /** PENDING rows the current user uploaded for `purpose`. */
  abstract findClaimable(ids: string[], purpose: FilePurpose): Promise<FileRecord[]>;
  abstract countPendingByCurrentUser(): Promise<number>;
  abstract markRejected(id: string): Promise<void>;
  /** PENDING → READY for verified uploads of the current user; throws FILE_NOT_FOUND otherwise. */
  abstract markReady(ids: string[], purpose: FilePurpose): Promise<void>;
  /** Whether the user has a membership in the caller's institute. */
  abstract isMemberOfCurrentTenant(userId: string): Promise<boolean>;
  /** Records the stored sizes of a pending image; it is WebP from then on. */
  abstract saveProcessedImage(id: string, image: ProcessedImageData): Promise<void>;
  /** Null when the file is not attached to a live leave. */
  abstract findLeaveForFile(fileId: string): Promise<FileLeaveOwner | null>;
  /**
   * The user document a file is a page of. Null unless the document belongs to a student of
   * this institute whom `ability` may read.
   */
  abstract findStudentDocumentForFile(
    fileId: string,
    ability: AppAbility,
  ): Promise<FileDocumentOwner | null>;
}
