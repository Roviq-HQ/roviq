import type { FilePurpose } from '@roviq/common-types';

export type BrandingImageColumn = 'logoFileId' | 'faviconFileId' | 'coverImageFileId';

/** The image columns of `institute_branding` and the upload purpose each one accepts. */
export const BRANDING_IMAGES: readonly { column: BrandingImageColumn; purpose: FilePurpose }[] = [
  { column: 'logoFileId', purpose: 'INSTITUTE_LOGO' },
  { column: 'faviconFileId', purpose: 'INSTITUTE_FAVICON' },
  { column: 'coverImageFileId', purpose: 'INSTITUTE_COVER' },
];
