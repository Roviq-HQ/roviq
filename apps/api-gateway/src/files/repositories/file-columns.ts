import { filesLive } from '@roviq/database';

/** Read projection of a file; shared with repositories that load a record's attachments. */
export const fileLiveColumns = {
  id: filesLive.id,
  tenantId: filesLive.tenantId,
  resellerId: filesLive.resellerId,
  subjectUserId: filesLive.subjectUserId,
  visibility: filesLive.visibility,
  purpose: filesLive.purpose,
  objectKey: filesLive.objectKey,
  originalName: filesLive.originalName,
  contentType: filesLive.contentType,
  sizeBytes: filesLive.sizeBytes,
  width: filesLive.width,
  height: filesLive.height,
  variants: filesLive.variants,
  placeholder: filesLive.placeholder,
  status: filesLive.status,
  uploadedBy: filesLive.uploadedBy,
  createdAt: filesLive.createdAt,
} as const;
