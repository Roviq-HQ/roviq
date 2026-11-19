import type { FilePurpose } from '@roviq/common-types';
import type { CreateFileData, FileLeaveOwner, FileRecord, ProcessedImageData } from './types';

/** Institute-scoped access to `files`. Tenant and actor come from the request context. */
export abstract class FileRepository {
  abstract create(data: CreateFileData): Promise<FileRecord>;
  abstract findById(id: string): Promise<FileRecord | null>;
  abstract findByIds(ids: string[]): Promise<FileRecord[]>;
  /** PENDING rows the current user uploaded for `purpose`. */
  abstract findClaimable(ids: string[], purpose: FilePurpose): Promise<FileRecord[]>;
  abstract countPendingByCurrentUser(): Promise<number>;
  abstract markRejected(id: string): Promise<void>;
  /** Records the stored sizes of a pending image; it is WebP from then on. */
  abstract saveProcessedImage(id: string, image: ProcessedImageData): Promise<void>;
  /** Null when the file is not attached to a live leave. */
  abstract findLeaveForFile(fileId: string): Promise<FileLeaveOwner | null>;
}
