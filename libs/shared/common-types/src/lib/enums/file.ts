// ─── FileVisibility ───────────────────────────────────────────────────────────

export const FILE_VISIBILITY_VALUES = [
  // Stored in the private bucket; read only through a signed, expiring URL
  'PRIVATE',
  // Stored in the public bucket; readable by anyone without sign-in (branding)
  'PUBLIC',
] as const;

export type FileVisibility = (typeof FILE_VISIBILITY_VALUES)[number];

export const FileVisibility = Object.fromEntries(FILE_VISIBILITY_VALUES.map((v) => [v, v])) as {
  readonly [K in FileVisibility]: K;
};

// ─── FileStatus ───────────────────────────────────────────────────────────────

export const FILE_STATUS_VALUES = [
  // Upload URL issued; bytes not verified and not attached to any record yet
  'PENDING',
  // Verified and attached to a record; the only status that can be downloaded
  'READY',
  // Failed verification (wrong size or content); the object has been removed
  'REJECTED',
  // Detached from its record; the object is purged after the grace period
  'DELETED',
] as const;

export type FileStatus = (typeof FILE_STATUS_VALUES)[number];

export const FileStatus = Object.fromEntries(FILE_STATUS_VALUES.map((v) => [v, v])) as {
  readonly [K in FileStatus]: K;
};

// ─── FilePurpose ──────────────────────────────────────────────────────────────

export const FILE_PURPOSE_VALUES = [
  // Supporting document attached to a leave application (e.g. medical certificate)
  'LEAVE_ATTACHMENT',
  // CSV uploaded by an institute admin for bulk student import
  'BULK_IMPORT_CSV',
  // Error report CSV written by the bulk student import workflow
  'BULK_IMPORT_REPORT',
  // A person's profile picture; belongs to the user, shown in every institute they are in
  'PROFILE_PHOTO',
  // A reseller's logo, shown before sign-in on its white-label portal; public
  'RESELLER_LOGO',
  // A reseller's browser-tab icon, stored square; public
  'RESELLER_FAVICON',
] as const;

export type FilePurpose = (typeof FILE_PURPOSE_VALUES)[number];

export const FilePurpose = Object.fromEntries(FILE_PURPOSE_VALUES.map((v) => [v, v])) as {
  readonly [K in FilePurpose]: K;
};

// ─── ImageVariant ─────────────────────────────────────────────────────────────

export const IMAGE_VARIANT_VALUES = [
  // 128 px: lists and avatars
  'SM',
  // 512 px: cards and detail headers
  'MD',
  // Largest stored size: viewing
  'FULL',
] as const;

export type ImageVariant = (typeof IMAGE_VARIANT_VALUES)[number];

export const ImageVariant = Object.fromEntries(IMAGE_VARIANT_VALUES.map((v) => [v, v])) as {
  readonly [K in ImageVariant]: K;
};
