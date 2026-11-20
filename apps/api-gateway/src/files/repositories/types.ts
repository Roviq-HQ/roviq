import type {
  FilePurpose,
  FileStatus,
  FileVisibility,
  UserDocumentType,
} from '@roviq/common-types';
import type { StoredImageVariant } from '@roviq/database';

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
  /** Pixels of the FULL size; null unless the file is an image. */
  width: number | null;
  height: number | null;
  variants: StoredImageVariant[] | null;
  placeholder: string | null;
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

/** The user document a file is a page of. */
export interface FileDocumentOwner {
  id: string;
  type: UserDocumentType;
}

/** The admission application document a file is a page of. */
export interface FileApplicationDocumentOwner {
  id: string;
  type: string;
}

/** What processing turned an uploaded image into. */
export interface ProcessedImageData {
  width: number;
  height: number;
  variants: StoredImageVariant[];
  placeholder: string;
  /** Sum of the stored sizes. */
  sizeBytes: number;
}

export interface CreateFileData {
  /** Set for a file owned by a person; it then has no institute. */
  subjectUserId: string | null;
  visibility: FileVisibility;
  purpose: FilePurpose;
  /** Builds the storage key from the new row's id. */
  objectKey: (id: string) => string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  status: FileStatus;
}
