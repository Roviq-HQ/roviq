/**
 * Creates the two storage buckets in a dev or e2e object store and makes the public one
 * anonymously readable. Safe to re-run. Production buckets are created by infrastructure
 * (docs/deployment.md), never by this script.
 *
 * Usage: pnpm storage:init
 */
import 'dotenv/config';
import {
  BucketAlreadyOwnedByYou,
  CreateBucketCommand,
  PutBucketPolicyCommand,
  S3Client,
} from '@aws-sdk/client-s3';

if (process.env.NODE_ENV === 'production') {
  console.error('storage:init is for dev and e2e only.');
  process.exit(1);
}

function required(name: string, value: string | undefined): string {
  if (!value) {
    console.error(`${name} is not set. Copy it from .env.example into .env.`);
    process.exit(1);
  }
  return value;
}

const endpoint = required('S3_ENDPOINT', process.env.S3_ENDPOINT);
const privateBucket = required('S3_BUCKET_PRIVATE', process.env.S3_BUCKET_PRIVATE);
const publicBucket = required('S3_BUCKET_PUBLIC', process.env.S3_BUCKET_PUBLIC);

const client = new S3Client({
  endpoint,
  region: required('S3_REGION', process.env.S3_REGION),
  forcePathStyle: true,
  credentials: {
    accessKeyId: required('S3_ACCESS_KEY', process.env.S3_ACCESS_KEY),
    secretAccessKey: required('S3_SECRET_KEY', process.env.S3_SECRET_KEY),
  },
});

async function ensureBucket(bucket: string): Promise<void> {
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    console.info(`Created bucket ${bucket}`);
  } catch (err) {
    if (!(err instanceof BucketAlreadyOwnedByYou)) throw err;
    console.info(`Bucket ${bucket} already exists`);
  }
}

async function init(): Promise<void> {
  await ensureBucket(privateBucket);
  await ensureBucket(publicBucket);
  await client.send(
    new PutBucketPolicyCommand({
      Bucket: publicBucket,
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: '*',
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${publicBucket}/*`],
          },
        ],
      }),
    }),
  );
  console.info(`Bucket ${publicBucket} is readable without sign-in`);
}

const ATTEMPTS = 30;

async function main(): Promise<void> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      await init();
      return;
    } catch (err) {
      if (attempt === ATTEMPTS) throw err;
      console.info(`Waiting for object storage at ${endpoint} (attempt ${attempt}/${ATTEMPTS})`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

main().catch((err) => {
  console.error('storage:init failed:', err);
  process.exit(1);
});
