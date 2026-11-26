/**
 * Applies the CORS rule and the lifecycle rules the app relies on to two existing buckets of any
 * S3-compatible store (staging, production). It never creates a bucket and never writes a bucket
 * policy: those, encryption and replication belong to infrastructure (docs/deployment.md).
 * Rules already on a bucket with other ids are kept; ours are replaced by id. Needs a key that
 * may read and write the buckets' CORS and lifecycle configuration, not the app's key.
 *
 * Usage:
 *   pnpm storage:configure            # merge, write, read back and compare; exit 1 on a difference
 *   pnpm storage:configure --dry-run  # print our rules as JSON, send nothing
 */
import 'dotenv/config';
import {
  type CORSRule,
  GetBucketCorsCommand,
  GetBucketLifecycleConfigurationCommand,
  type LifecycleRule,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import {
  type BucketPlan,
  mergeRules,
  parseOrigins,
  ruleDifferences,
  S3_CHECKSUM_OPTIONS,
  storagePlan,
} from './lib/storage-rules';

function required(name: string, value: string | undefined): string {
  if (!value) {
    console.error(`${name} is not set.`);
    process.exit(1);
  }
  return value;
}

const plan = storagePlan({
  privateBucket: required('S3_BUCKET_PRIVATE', process.env.S3_BUCKET_PRIVATE),
  publicBucket: required('S3_BUCKET_PUBLIC', process.env.S3_BUCKET_PUBLIC),
  origins: parseOrigins(required('ALLOWED_ORIGINS', process.env.ALLOWED_ORIGINS)),
});

/** A bucket with no configuration of that kind answers with an error code, not an empty list. */
async function readOrEmpty<T>(read: () => Promise<T[] | undefined>, missingCode: string) {
  try {
    return (await read()) ?? [];
  } catch (err) {
    if (err instanceof S3ServiceException && err.name === missingCode) return [];
    throw err;
  }
}

function ids(rules: { ID?: string }[]): string {
  return rules.map((rule) => rule.ID ?? '(no id)').join(', ') || 'none';
}

async function configure(client: S3Client, bucket: BucketPlan): Promise<string[]> {
  const readCors = () =>
    readOrEmpty<CORSRule>(
      async () =>
        (await client.send(new GetBucketCorsCommand({ Bucket: bucket.bucket }))).CORSRules,
      'NoSuchCORSConfiguration',
    );
  const readLifecycle = () =>
    readOrEmpty<LifecycleRule>(
      async () =>
        (await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket.bucket })))
          .Rules,
      'NoSuchLifecycleConfiguration',
    );

  if (bucket.cors.length > 0) {
    const cors = mergeRules(await readCors(), bucket.cors);
    await client.send(
      new PutBucketCorsCommand({
        Bucket: bucket.bucket,
        CORSConfiguration: { CORSRules: cors.rules },
      }),
    );
    console.info(`${bucket.bucket} CORS: kept ${ids(cors.kept)}; wrote ${ids(bucket.cors)}`);
  }
  const lifecycle = mergeRules(await readLifecycle(), bucket.lifecycle);
  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket.bucket,
      LifecycleConfiguration: { Rules: lifecycle.rules },
    }),
  );
  console.info(
    `${bucket.bucket} lifecycle: kept ${ids(lifecycle.kept)}; wrote ${ids(bucket.lifecycle)}`,
  );

  // Some stores accept a rule and drop parts of it silently.
  return ruleDifferences({
    plannedCors: bucket.cors,
    appliedCors: bucket.cors.length > 0 ? await readCors() : [],
    plannedLifecycle: bucket.lifecycle,
    appliedLifecycle: await readLifecycle(),
  }).map((difference) => `${bucket.bucket}: ${difference}`);
}

async function apply(): Promise<void> {
  const client = new S3Client({
    endpoint: required('S3_ENDPOINT', process.env.S3_ENDPOINT),
    region: required('S3_REGION', process.env.S3_REGION),
    forcePathStyle: true,
    ...S3_CHECKSUM_OPTIONS,
    credentials: {
      accessKeyId: required('S3_ACCESS_KEY', process.env.S3_ACCESS_KEY),
      secretAccessKey: required('S3_SECRET_KEY', process.env.S3_SECRET_KEY),
    },
  });

  const differences: string[] = [];
  for (const bucket of plan) differences.push(...(await configure(client, bucket)));
  if (differences.length > 0) {
    console.error(
      `\nThe store did not keep these rules as written:\n  ${differences.join('\n  ')}`,
    );
    process.exit(1);
  }
  console.info('\nApplied and read back. Run pnpm storage:check next.');
}

if (process.argv.includes('--dry-run')) {
  console.info(JSON.stringify(plan, null, 2));
} else {
  apply().catch((err) => {
    console.error('storage:configure failed:', err);
    process.exit(1);
  });
}
