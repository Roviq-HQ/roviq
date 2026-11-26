/**
 * Applies the CORS rule and the lifecycle rules the app relies on to two existing buckets of any
 * S3-compatible store (staging, production). It never creates a bucket and never writes a bucket
 * policy: those, encryption and replication belong to infrastructure (docs/deployment.md).
 *
 * Usage:
 *   pnpm storage:configure            # apply, then read the rules back
 *   pnpm storage:configure --dry-run  # print the rules as JSON, send nothing
 */
import 'dotenv/config';
import {
  GetBucketCorsCommand,
  GetBucketLifecycleConfigurationCommand,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  parseOrigins,
  portalCorsRule,
  privateBucketLifecycle,
  publicBucketLifecycle,
  S3_CHECKSUM_OPTIONS,
} from './lib/storage-rules';

function required(name: string, value: string | undefined): string {
  if (!value) {
    console.error(`${name} is not set.`);
    process.exit(1);
  }
  return value;
}

const dryRun = process.argv.includes('--dry-run');
const privateBucket = required('S3_BUCKET_PRIVATE', process.env.S3_BUCKET_PRIVATE);
const publicBucket = required('S3_BUCKET_PUBLIC', process.env.S3_BUCKET_PUBLIC);
const cors = portalCorsRule(parseOrigins(required('ALLOWED_ORIGINS', process.env.ALLOWED_ORIGINS)));
const plan = {
  [privateBucket]: { cors: [cors], lifecycle: privateBucketLifecycle() },
  [publicBucket]: { cors: [], lifecycle: publicBucketLifecycle() },
};

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

  await client.send(
    new PutBucketCorsCommand({ Bucket: privateBucket, CORSConfiguration: { CORSRules: [cors] } }),
  );
  for (const [bucket, rules] of [
    [privateBucket, privateBucketLifecycle()],
    [publicBucket, publicBucketLifecycle()],
  ] as const) {
    await client.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: bucket,
        LifecycleConfiguration: { Rules: rules },
      }),
    );
  }

  // Read back: some stores accept a rule and drop parts of it silently.
  const appliedCors = await client.send(new GetBucketCorsCommand({ Bucket: privateBucket }));
  console.info(`${privateBucket} CORS: ${JSON.stringify(appliedCors.CORSRules ?? [])}`);
  for (const bucket of [privateBucket, publicBucket]) {
    const applied = await client.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }),
    );
    const ids = (applied.Rules ?? []).map((rule) => rule.ID).join(', ');
    console.info(`${bucket} lifecycle rules: ${ids}`);
  }
  console.info('\nApplied. Run pnpm storage:check next.');
}

if (dryRun) {
  console.info(JSON.stringify(plan, null, 2));
} else {
  apply().catch((err) => {
    console.error('storage:configure failed:', err);
    process.exit(1);
  });
}
