import { type FileContentType, type FilePurpose, fileExtensionFor } from '@roviq/common-types';

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
