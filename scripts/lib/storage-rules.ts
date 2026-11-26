import type { CORSRule, LifecycleRule } from '@aws-sdk/client-s3';

export { S3_CHECKSUM_OPTIONS } from '../../libs/backend/storage/src/s3-checksum-options';

/** Prefix that `storage:check` writes under; the lifecycle rule cleans up after an aborted run. */
/** Temporary sign-ins (`aws login`, STS) carry a session token; a static key does not. */
export function storageCredentials(input: {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string | undefined;
}): { accessKeyId: string; secretAccessKey: string; sessionToken?: string } {
  const { accessKeyId, secretAccessKey, sessionToken } = input;
  return sessionToken
    ? { accessKeyId, secretAccessKey, sessionToken }
    : { accessKeyId, secretAccessKey };
}

export const STORAGE_CHECK_PREFIX = '__storage-check__/';

export function parseOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export const PORTAL_CORS_RULE_ID = 'roviq-portals';

/** Browsers upload straight to the private bucket from the portals and download from it. */
export function portalCorsRule(origins: string[]): CORSRule {
  if (origins.length === 0) throw new Error('ALLOWED_ORIGINS lists no portal origin');
  return {
    ID: PORTAL_CORS_RULE_ID,
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

/** What `storage:configure` writes to each of the two buckets. */
export interface BucketPlan {
  bucket: string;
  cors: CORSRule[];
  lifecycle: LifecycleRule[];
}

export function storagePlan(input: {
  privateBucket: string;
  publicBucket: string;
  origins: string[];
}): BucketPlan[] {
  return [
    {
      bucket: input.privateBucket,
      cors: [portalCorsRule(input.origins)],
      lifecycle: privateBucketLifecycle(),
    },
    { bucket: input.publicBucket, cors: [], lifecycle: publicBucketLifecycle() },
  ];
}

/**
 * Rules someone else put on the bucket (replication, version expiry, a manual rule) are kept:
 * ours replace only the rules with our ids. A rule without an id is kept unless it is a copy of
 * one of ours (written before our rules had ids).
 */
export function mergeRules<T extends { ID?: string }>(
  existing: T[],
  ours: T[],
): { rules: T[]; kept: T[] } {
  const ourIds = new Set(ours.map((rule) => rule.ID));
  const ourContents = new Set(ours.map(contentKey));
  const kept = existing.filter((rule) =>
    rule.ID === undefined ? !ourContents.has(contentKey(rule)) : !ourIds.has(rule.ID),
  );
  return { rules: [...kept, ...ours], kept };
}

/** A rule without its id, with keys in a fixed order: an unnamed copy of ours is ours. */
function contentKey(rule: { ID?: string }): string {
  const { ID: _id, ...content } = rule;
  return JSON.stringify(content, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  );
}

function sorted(values: string[] | undefined): string {
  return [...(values ?? [])]
    .map((value) => value.toLowerCase())
    .sort()
    .join(',');
}

function corsShape(rule: CORSRule): string {
  return JSON.stringify([
    sorted(rule.AllowedOrigins),
    sorted(rule.AllowedMethods),
    sorted(rule.AllowedHeaders),
    sorted(rule.ExposeHeaders),
    rule.MaxAgeSeconds ?? null,
  ]);
}

// Stores return a rule's prefix either inside Filter or on the rule, and may drop an empty one.
function lifecycleShape(rule: LifecycleRule): string {
  return JSON.stringify([
    rule.Status,
    rule.Filter?.Prefix ?? rule.Prefix ?? '',
    rule.Expiration?.Days ?? null,
    rule.AbortIncompleteMultipartUpload?.DaysAfterInitiation ?? null,
  ]);
}

/**
 * Our rules the store did not keep as written, by id, after a read-back. A store that accepts a
 * rule and silently drops part of it shows up here.
 */
export function ruleDifferences(input: {
  plannedCors: CORSRule[];
  appliedCors: CORSRule[];
  plannedLifecycle: LifecycleRule[];
  appliedLifecycle: LifecycleRule[];
}): string[] {
  const differences: string[] = [];
  for (const planned of input.plannedCors) {
    const applied = input.appliedCors.find((rule) => corsShape(rule) === corsShape(planned));
    if (!applied) differences.push(`CORS rule ${planned.ID ?? '(no id)'}`);
  }
  for (const planned of input.plannedLifecycle) {
    const applied = input.appliedLifecycle.find((rule) => rule.ID === planned.ID);
    if (!applied || lifecycleShape(applied) !== lifecycleShape(planned)) {
      differences.push(`lifecycle rule ${planned.ID ?? '(no id)'}`);
    }
  }
  return differences;
}
