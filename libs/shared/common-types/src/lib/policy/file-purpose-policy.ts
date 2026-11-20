import type { AppAction, AppSubject } from '../common-types';
import type { FilePurpose, FileVisibility, ImageVariant } from '../enums/file';

const MB = 1024 * 1024;

export const FILE_CONTENT_TYPE = {
  PDF: 'application/pdf',
  JPEG: 'image/jpeg',
  PNG: 'image/png',
  WEBP: 'image/webp',
  CSV: 'text/csv',
} as const;

export type FileContentType = (typeof FILE_CONTENT_TYPE)[keyof typeof FILE_CONTENT_TYPE];

const IMAGE_CONTENT_TYPES = [
  FILE_CONTENT_TYPE.JPEG,
  FILE_CONTENT_TYPE.PNG,
  FILE_CONTENT_TYPE.WEBP,
] as const;

const DOCUMENT_TYPES = [
  FILE_CONTENT_TYPE.PDF,
  FILE_CONTENT_TYPE.JPEG,
  FILE_CONTENT_TYPE.PNG,
  FILE_CONTENT_TYPE.WEBP,
] as const;

/** How an uploaded image of a purpose is stored. Every image is re-encoded to WebP. */
export interface ImageStoragePolicy {
  /** Square crop for avatars; false keeps the picture's own shape. */
  square: boolean;
  /** Long side of the FULL size, in pixels. */
  fullPx: number;
  /**
   * Give SM and MD links that stay the same for hours, so lists of them load from the browser
   * cache. A leaked link then works for hours too: only for pictures shown widely anyway
   * (avatars), never for scans of documents.
   */
  cacheableThumbnails: boolean;
}

/** Scans of documents: shape kept, large enough to read small print, short-lived links only. */
const DOCUMENT_IMAGE: ImageStoragePolicy = {
  square: false,
  fullPx: 2560,
  cacheableThumbnails: false,
};

/** Long side of the SM and MD sizes, in pixels; FULL comes from the purpose. */
export const IMAGE_VARIANT_PX: { readonly [V in Exclude<ImageVariant, 'FULL'>]: number } = {
  SM: 128,
  MD: 512,
};

const IMAGE_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function isImageContentType(contentType: string): boolean {
  return IMAGE_TYPES.has(contentType);
}

/** Images wider or taller than this are scaled down in the browser before upload. */
export const IMAGE_UPLOAD_MAX_PX = 2560;

/**
 * Largest image a user may pick. It is scaled down in the browser first, and the result must
 * then fit the purpose's own size limit.
 */
export const IMAGE_PICK_MAX_BYTES = 50 * MB;

/** A fixed ability, or any signed-in member (the real check is where the file gets attached). */
export type FileAbility = { action: AppAction; subject: AppSubject } | 'AUTHENTICATED';

/** Profile pictures: square, shown small and often, so their thumbnails may be cached. */
const AVATAR_IMAGE: ImageStoragePolicy = { square: true, fullPx: 1024, cacheableThumbnails: true };

export type FileOwner = 'INSTITUTE' | 'USER' | 'RESELLER';

/** Branding shown on pages anyone can open: kept large enough for a header, never cropped. */
const LOGO_IMAGE: ImageStoragePolicy = { square: false, fullPx: 1024, cacheableThumbnails: false };
/** Browser-tab icons are square; 512 px covers every size a browser or phone asks for. */
const ICON_IMAGE: ImageStoragePolicy = { square: true, fullPx: 512, cacheableThumbnails: false };

export interface FilePurposePolicy {
  visibility: FileVisibility;
  /**
   * INSTITUTE: the file belongs to the uploader's institute. USER: it belongs to the person it
   * is about (`subject_user_id`) and is visible in every institute that person is a member of.
   * RESELLER: it belongs to the uploader's reseller and is uploaded from the reseller portal.
   */
  owner: FileOwner;
  allowedContentTypes: readonly FileContentType[];
  maxSizeBytes: number;
  /** Sensitive files expose no URL in list queries; download goes through the audited call. */
  sensitive: boolean;
  /** How images of this purpose are stored. Null: the purpose accepts no images. */
  image: ImageStoragePolicy | null;
  /** Ability a user needs to upload for this purpose. Null: written by the server only. */
  uploadAbility: FileAbility | null;
  /** Ability a user needs to download a file of this purpose. */
  readAbility: FileAbility;
}

/** The single place that says what each file purpose allows. */
export const FILE_PURPOSE_POLICY: { readonly [P in FilePurpose]: FilePurposePolicy } = {
  LEAVE_ATTACHMENT: {
    visibility: 'PRIVATE',
    owner: 'INSTITUTE',
    allowedContentTypes: DOCUMENT_TYPES,
    maxSizeBytes: 10 * MB,
    sensitive: false,
    image: DOCUMENT_IMAGE,
    uploadAbility: { action: 'create', subject: 'Leave' },
    readAbility: { action: 'read', subject: 'Leave' },
  },
  BULK_IMPORT_CSV: {
    visibility: 'PRIVATE',
    owner: 'INSTITUTE',
    allowedContentTypes: [FILE_CONTENT_TYPE.CSV],
    maxSizeBytes: 10 * MB,
    sensitive: false,
    image: null,
    uploadAbility: { action: 'create', subject: 'Student' },
    readAbility: { action: 'create', subject: 'Student' },
  },
  BULK_IMPORT_REPORT: {
    visibility: 'PRIVATE',
    owner: 'INSTITUTE',
    allowedContentTypes: [FILE_CONTENT_TYPE.CSV],
    maxSizeBytes: 50 * MB,
    sensitive: false,
    image: null,
    uploadAbility: null,
    readAbility: { action: 'create', subject: 'Student' },
  },
  PROFILE_PHOTO: {
    visibility: 'PRIVATE',
    owner: 'USER',
    allowedContentTypes: IMAGE_CONTENT_TYPES,
    maxSizeBytes: 10 * MB,
    sensitive: false,
    image: AVATAR_IMAGE,
    // Who may set a person's picture is decided by the mutation that attaches it (update
    // student, staff, guardian or own profile); an unattached upload is never shown.
    uploadAbility: 'AUTHENTICATED',
    // Row-level security already limits these to members of the person's institutes.
    readAbility: 'AUTHENTICATED',
  },
  RESELLER_LOGO: {
    visibility: 'PUBLIC',
    owner: 'RESELLER',
    allowedContentTypes: IMAGE_CONTENT_TYPES,
    maxSizeBytes: 5 * MB,
    sensitive: false,
    image: LOGO_IMAGE,
    uploadAbility: { action: 'update', subject: 'Reseller' },
    // Public by design: the object is readable by anyone who has its address.
    readAbility: 'AUTHENTICATED',
  },
  RESELLER_FAVICON: {
    visibility: 'PUBLIC',
    owner: 'RESELLER',
    allowedContentTypes: IMAGE_CONTENT_TYPES,
    maxSizeBytes: 2 * MB,
    sensitive: false,
    image: ICON_IMAGE,
    uploadAbility: { action: 'update', subject: 'Reseller' },
    readAbility: 'AUTHENTICATED',
  },
  USER_DOCUMENT: {
    visibility: 'PRIVATE',
    owner: 'USER',
    allowedContentTypes: DOCUMENT_TYPES,
    maxSizeBytes: 10 * MB,
    // Identity scans: no link in lists, every download goes through the audited call.
    sensitive: true,
    image: DOCUMENT_IMAGE,
    uploadAbility: { action: 'update', subject: 'Student' },
    // Checked against the very student the document belongs to, see FileService.canRead.
    readAbility: { action: 'read', subject: 'Student' },
  },
  STAFF_CERTIFICATE: {
    visibility: 'PRIVATE',
    owner: 'INSTITUTE',
    allowedContentTypes: DOCUMENT_TYPES,
    maxSizeBytes: 10 * MB,
    sensitive: false,
    image: DOCUMENT_IMAGE,
    uploadAbility: { action: 'update', subject: 'Staff' },
    readAbility: { action: 'read', subject: 'Staff' },
  },
};

const EXTENSION: { readonly [T in FileContentType]: string } = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'text/csv': 'csv',
};

export function isFileContentType(value: string): value is FileContentType {
  return Object.hasOwn(EXTENSION, value);
}

export function fileExtensionFor(contentType: FileContentType): string {
  return EXTENSION[contentType];
}

/** True when the first bytes of a file match what its declared type must look like. */
export function fileContentMatchesType(head: Uint8Array, contentType: FileContentType): boolean {
  const starts = (...bytes: number[]) => bytes.every((byte, i) => head[i] === byte);
  switch (contentType) {
    case 'application/pdf':
      return starts(0x25, 0x50, 0x44, 0x46, 0x2d);
    case 'image/jpeg':
      return starts(0xff, 0xd8, 0xff);
    case 'image/png':
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'image/webp':
      return (
        starts(0x52, 0x49, 0x46, 0x46) &&
        head[8] === 0x57 &&
        head[9] === 0x45 &&
        head[10] === 0x42 &&
        head[11] === 0x50
      );
    case 'text/csv':
      // CSV has no signature; a NUL byte means the file is binary.
      return head.length > 0 && !head.includes(0x00);
  }
}

/** How many leading bytes `fileContentMatchesType` needs. */
export const FILE_SIGNATURE_BYTES = 512;
