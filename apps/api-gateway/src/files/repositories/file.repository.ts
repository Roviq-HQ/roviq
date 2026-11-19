import type { FilePurpose } from '@roviq/common-types';
import type { CreateFileData, FileRecord } from './types';

/** Institute-scoped access to `files`. Tenant and actor come from the request context. */
export abstract class FileRepository {
  abstract create(data: CreateFileData): Promise<FileRecord>;
  abstract findById(id: string): Promise<FileRecord | null>;
  abstract findByIds(ids: string[]): Promise<FileRecord[]>;
  /** PENDING rows the current user uploaded for `purpose`. */
  abstract findClaimable(ids: string[], purpose: FilePurpose): Promise<FileRecord[]>;
  abstract countPendingByCurrentUser(): Promise<number>;
  abstract markRejected(id: string): Promise<void>;
}
