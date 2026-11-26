/**
 * Every S3 client of the app and the storage scripts. By default the SDK puts a CRC32 of an empty
 * body into every presigned PUT URL, which a strict store checks against the browser's upload
 * and refuses.
 */
export const S3_CHECKSUM_OPTIONS = {
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
} as const;
