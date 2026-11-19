import type { FilePurpose, FileStatus, FileVisibility } from '@roviq/common-types';

export interface FileRecord {
  id: string;
  tenantId: string | null;
  resellerId: string | null;
  subjectUserId: string | null;
  visibility: FileVisibility;
  purpose: FilePurpose;
  objectKey: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  status: FileStatus;
  uploadedBy: string;
  createdAt: Date;
}

/** The leave a file is attached to, with the fields leave abilities are conditioned on. */
export interface FileLeaveOwner {
  id: string;
  tenantId: string;
  userId: string;
}

export interface CreateFileData {
  visibility: FileVisibility;
  purpose: FilePurpose;
  /** Builds the storage key from the new row's id. */
  objectKey: (id: string) => string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  status: FileStatus;
}
