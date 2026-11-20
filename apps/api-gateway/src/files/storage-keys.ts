import {
  type FileContentType,
  type FilePurpose,
  type FileVisibility,
  fileExtensionFor,
  type ImageVariant,
} from '@roviq/common-types';
import type { StorageBucket } from '@roviq/storage';

/** Storage key of a file: `{owner}/{purpose}/{fileId}.{ext}`, e.g. `institutes/{id}/…`. */
export function storageKeyFor(
  ownerPrefix: string,
  purpose: FilePurpose,
  fileId: string,
  contentType: FileContentType,
): string {
  const folder = purpose.toLowerCase().replaceAll('_', '-');
  return `${ownerPrefix}/${folder}/${fileId}.${fileExtensionFor(contentType)}`;
}

/** Key of one stored size of an image: `…/{fileId}/sm.webp`. */
export function variantKeyOf(objectKey: string, variant: ImageVariant): string {
  return `${objectKey.replace(/\.[a-z0-9]+$/, '')}/${variant.toLowerCase()}.webp`;
}

/** The bucket a file is served from. */
export function bucketOf(file: { visibility: FileVisibility }): StorageBucket {
  return file.visibility === 'PUBLIC' ? 'public' : 'private';
}

/**
 * Where the browser uploads to. Always in the private bucket, and never the key a file is
 * served from: the upload URL stays valid for minutes, so the object behind it can still
 * change after it was checked.
 */
export function pendingKeyOf(file: { objectKey: string }): string {
  return `pending/${file.objectKey}`;
}

/** Every key a file may occupy in its own bucket, for cleanup. */
export function storedKeysOf(file: { objectKey: string }): string[] {
  return [
    file.objectKey,
    variantKeyOf(file.objectKey, 'SM'),
    variantKeyOf(file.objectKey, 'MD'),
    variantKeyOf(file.objectKey, 'FULL'),
  ];
}
