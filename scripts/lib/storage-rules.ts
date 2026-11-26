import type { CORSRule, LifecycleRule } from '@aws-sdk/client-s3';

export { S3_CHECKSUM_OPTIONS } from '../../libs/backend/storage/src/s3-checksum-options';

/** Prefix that `storage:check` writes under; the lifecycle rule cleans up after an aborted run. */
export const STORAGE_CHECK_PREFIX = '__storage-check__/';

export function parseOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/** Browsers upload straight to the private bucket from the portals and download from it. */
export function portalCorsRule(origins: string[]): CORSRule {
  if (origins.length === 0) throw new Error('ALLOWED_ORIGINS lists no portal origin');
  return {
    AllowedOrigins: origins,
    AllowedMethods: ['PUT', 'GET'],
    AllowedHeaders: ['Content-Type'],
    ExposeHeaders: ['ETag'],
    MaxAgeSeconds: 3600,
  };
}

/**
 * The app's sweeper removes abandoned `pending/` uploads after a day; the bucket rule is the
 * backstop for when the sweeper is not running.
 */
export function privateBucketLifecycle(): LifecycleRule[] {
  return [
    {
      ID: 'abort-unfinished-multipart',
      Status: 'Enabled',
      Filter: { Prefix: '' },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
    },
    {
      ID: 'expire-abandoned-uploads',
      Status: 'Enabled',
      Filter: { Prefix: 'pending/' },
      Expiration: { Days: 2 },
    },
    {
      ID: 'expire-storage-check',
      Status: 'Enabled',
      Filter: { Prefix: STORAGE_CHECK_PREFIX },
      Expiration: { Days: 1 },
    },
  ];
}

export function publicBucketLifecycle(): LifecycleRule[] {
  return [
    {
      ID: 'abort-unfinished-multipart',
      Status: 'Enabled',
      Filter: { Prefix: '' },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
    },
    {
      ID: 'expire-storage-check',
      Status: 'Enabled',
      Filter: { Prefix: STORAGE_CHECK_PREFIX },
      Expiration: { Days: 1 },
    },
  ];
}
