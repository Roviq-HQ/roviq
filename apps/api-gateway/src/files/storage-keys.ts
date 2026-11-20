import {
  type FileContentType,
  type FilePurpose,
  fileExtensionFor,
  type ImageVariant,
} from '@roviq/common-types';

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
