/**
 * Checks that the object store behind the S3_* variables behaves the way the app relies on.
 * Run it against a new provider (AWS S3, Cloudflare R2, a self-hosted server) before using it:
 *
 *   pnpm storage:check
 *
 * It needs both buckets to exist already, writes only under `__storage-check__/` and removes
 * what it wrote. Exit code 1 when any check fails. A check that cannot apply to this store (the
 * https checks against a plain-http dev store) prints SKIP and does not fail the run.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  parseOrigins,
  S3_CHECKSUM_OPTIONS,
  STORAGE_CHECK_PREFIX,
  storageCredentials,
} from './lib/storage-rules';

function required(name: string, value: string | undefined): string {
  if (!value) {
    console.error(`${name} is not set. Copy it from .env.example into .env.`);
    process.exit(1);
  }
  return value;
}

const shared = {
  region: required('S3_REGION', process.env.S3_REGION),
  forcePathStyle: true,
  ...S3_CHECKSUM_OPTIONS,
  credentials: storageCredentials({
    accessKeyId: required('S3_ACCESS_KEY', process.env.S3_ACCESS_KEY),
    secretAccessKey: required('S3_SECRET_KEY', process.env.S3_SECRET_KEY),
    sessionToken: process.env.S3_SESSION_TOKEN,
  }),
};
const server = new S3Client({
  ...shared,
  endpoint: required('S3_ENDPOINT', process.env.S3_ENDPOINT),
});
const browser = new S3Client({
  ...shared,
  endpoint: required('S3_PUBLIC_ENDPOINT', process.env.S3_PUBLIC_ENDPOINT),
});
const privateBucket = required('S3_BUCKET_PRIVATE', process.env.S3_BUCKET_PRIVATE);
const publicBucket = required('S3_BUCKET_PUBLIC', process.env.S3_BUCKET_PUBLIC);
const publicBaseUrl = required('S3_PUBLIC_BASE_URL', process.env.S3_PUBLIC_BASE_URL).replace(
  /\/+$/,
  '',
);

const publicEndpoint = required('S3_PUBLIC_ENDPOINT', process.env.S3_PUBLIC_ENDPOINT).replace(
  /\/+$/,
  '',
);
const portalOrigins = parseOrigins(required('ALLOWED_ORIGINS', process.env.ALLOWED_ORIGINS));

const prefix = `${STORAGE_CHECK_PREFIX}${randomUUID()}`;
const pendingKey = `${prefix}/pending/प्रमाण पत्र.pdf`;
const finalKey = `${prefix}/final.pdf`;
const publicKey = `${prefix}/logo.pdf`;
const anonymousKey = `${prefix}/anonymous.txt`;
const PDF = Buffer.from('%PDF-1.7\nstorage check');
const failures: string[] = [];
let skipped = 0;

function skip(name: string, reason: string): void {
  console.info(`SKIP  ${name} (${reason})`);
  skipped += 1;
}

async function check(name: string, run: () => Promise<boolean>): Promise<void> {
  let ok = false;
  let detail = '';
  try {
    ok = await run();
  } catch (err) {
    detail = err instanceof Error ? ` (${err.name}: ${err.message})` : '';
  }
  console.info(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail}`);
  if (!ok) failures.push(name);
}

function presignPut(key: string, contentLength: number): Promise<string> {
  return getSignedUrl(
    browser,
    new PutObjectCommand({
      Bucket: privateBucket,
      Key: key,
      ContentType: 'application/pdf',
      ContentLength: contentLength,
    }),
    { expiresIn: 300, signableHeaders: new Set(['content-type', 'content-length']) },
  );
}

async function put(url: string, body: Buffer, contentType: string): Promise<number> {
  const res = await fetch(url, { method: 'PUT', body, headers: { 'Content-Type': contentType } });
  return res.status;
}

async function exists(bucket: string, key: string): Promise<boolean> {
  try {
    await server.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

function copySource(bucket: string, key: string): string {
  return `${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function main(): Promise<void> {
  await check('both buckets exist', async () => {
    await server.send(new HeadBucketCommand({ Bucket: privateBucket }));
    await server.send(new HeadBucketCommand({ Bucket: publicBucket }));
    return true;
  });

  const uploadUrl = await presignPut(pendingKey, PDF.length);
  await check('presigned PUT URL carries no checksum parameter', async () => {
    return ![...new URL(uploadUrl).searchParams.keys()].some((name) => /checksum/i.test(name));
  });
  await check('presigned PUT accepts the declared size and type', async () => {
    return (await put(uploadUrl, PDF, 'application/pdf')) === 200;
  });
  for (const portalOrigin of portalOrigins) {
    await check(`browser preflight from ${portalOrigin} is allowed to upload`, async () => {
      const res = await fetch(uploadUrl, {
        method: 'OPTIONS',
        headers: {
          Origin: portalOrigin,
          'Access-Control-Request-Method': 'PUT',
          'Access-Control-Request-Headers': 'content-type',
        },
      });
      return res.ok && res.headers.get('access-control-allow-origin') === portalOrigin;
    });
  }
  await check('browser preflight from an unknown origin is not allowed', async () => {
    const res = await fetch(uploadUrl, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://not-a-roviq-portal.example',
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    const allowed = res.headers.get('access-control-allow-origin');
    return allowed !== '*' && allowed !== 'https://not-a-roviq-portal.example';
  });
  await check('presigned PUT refuses a larger body', async () => {
    const key = `${prefix}/pending/larger.pdf`;
    const status = await put(await presignPut(key, 10), Buffer.alloc(5000, 1), 'application/pdf');
    return status >= 400 && !(await exists(privateBucket, key));
  });
  await check('presigned PUT refuses a smaller body', async () => {
    const key = `${prefix}/pending/smaller.pdf`;
    const status = await put(await presignPut(key, 10), Buffer.alloc(3, 1), 'application/pdf');
    return status >= 400 && !(await exists(privateBucket, key));
  });
  await check('presigned PUT refuses another content type', async () => {
    const key = `${prefix}/pending/type.pdf`;
    const status = await put(await presignPut(key, 10), Buffer.alloc(10, 1), 'text/html');
    return status >= 400 && !(await exists(privateBucket, key));
  });

  await check('server-side copy inside the private bucket keeps size and type', async () => {
    await server.send(
      new CopyObjectCommand({
        Bucket: privateBucket,
        Key: finalKey,
        CopySource: copySource(privateBucket, pendingKey),
      }),
    );
    const head = await server.send(new HeadObjectCommand({ Bucket: privateBucket, Key: finalKey }));
    return head.ContentLength === PDF.length && head.ContentType === 'application/pdf';
  });
  await check('server-side copy from the private to the public bucket', async () => {
    await server.send(
      new CopyObjectCommand({
        Bucket: publicBucket,
        Key: publicKey,
        CopySource: copySource(privateBucket, pendingKey),
      }),
    );
    return exists(publicBucket, publicKey);
  });
  await check('a write through the upload URL does not change the copied object', async () => {
    await put(uploadUrl, Buffer.alloc(PDF.length, 0x41), 'application/pdf');
    const res = await server.send(new GetObjectCommand({ Bucket: privateBucket, Key: finalKey }));
    return Buffer.from((await res.Body?.transformToByteArray()) ?? []).equals(PDF);
  });

  await check('server write keeps its Cache-Control header', async () => {
    const key = `${prefix}/cached.pdf`;
    await server.send(
      new PutObjectCommand({
        Bucket: privateBucket,
        Key: key,
        Body: PDF,
        ContentType: 'application/pdf',
        CacheControl: 'private, max-age=86400',
      }),
    );
    const head = await server.send(new HeadObjectCommand({ Bucket: privateBucket, Key: key }));
    return head.CacheControl === 'private, max-age=86400';
  });

  await check('ranged read returns the first bytes', async () => {
    const res = await server.send(
      new GetObjectCommand({ Bucket: privateBucket, Key: finalKey, Range: 'bytes=0-4' }),
    );
    return Buffer.from((await res.Body?.transformToByteArray()) ?? []).toString() === '%PDF-';
  });

  const signingDate = new Date(Math.floor(Date.now() / 21_600_000) * 21_600_000);
  const presignGet = () =>
    getSignedUrl(
      browser,
      new GetObjectCommand({
        Bucket: privateBucket,
        Key: finalKey,
        ResponseContentDisposition: 'attachment; filename="check.pdf"',
      }),
      { expiresIn: 43_200, signingDate },
    );
  await check('presigned GET serves the file with the requested download name', async () => {
    const res = await fetch(await presignGet());
    const disposition = res.headers.get('content-disposition') ?? '';
    return res.status === 200 && disposition.includes('check.pdf');
  });
  await check('presigned GET with a fixed signing time is stable (cacheable)', async () => {
    const first = await presignGet();
    const second = await presignGet();
    return first === second;
  });
  await check('a presigned GET cannot be reused for another key', async () => {
    const tampered = (await presignGet()).replace('final.pdf', 'pending/larger.pdf');
    return (await fetch(tampered)).status >= 400;
  });

  const encodedPublicKey = publicKey.split('/').map(encodeURIComponent).join('/');
  await check(
    'public bucket object is readable without sign-in at S3_PUBLIC_BASE_URL',
    async () => {
      return (await fetch(`${publicBaseUrl}/${encodedPublicKey}`)).status === 200;
    },
  );
  await check('private bucket object is NOT readable without sign-in', async () => {
    return (await fetch(`${publicEndpoint}/${privateBucket}/${finalKey}`)).status >= 400;
  });
  await check('public bucket cannot be listed without sign-in', async () => {
    const urls = [`${publicBaseUrl}/`, `${publicEndpoint}/${publicBucket}?list-type=2`];
    for (const url of urls) {
      const res = await fetch(url);
      if (res.ok && (await res.text()).includes('ListBucketResult')) return false;
    }
    return true;
  });
  await check('public bucket refuses a write without sign-in', async () => {
    const res = await fetch(`${publicEndpoint}/${publicBucket}/${anonymousKey}`, {
      method: 'PUT',
      body: 'anonymous',
      headers: { 'Content-Type': 'text/plain' },
    });
    return res.status >= 400 && !(await exists(publicBucket, anonymousKey));
  });
  if (publicEndpoint.startsWith('https://')) {
    await check('a download link over plain http is not served', async () => {
      const plain = (await presignGet()).replace(/^https:/, 'http:');
      try {
        return (await fetch(plain, { redirect: 'manual' })).status !== 200;
      } catch {
        return true;
      }
    });
  } else {
    skip('a download link over plain http is not served', 'S3_PUBLIC_ENDPOINT is not https');
  }

  await check('batch delete removes objects and tolerates a missing key', async () => {
    const res = await server.send(
      new DeleteObjectsCommand({
        Bucket: privateBucket,
        Delete: {
          Objects: [
            { Key: pendingKey },
            { Key: finalKey },
            { Key: `${prefix}/cached.pdf` },
            { Key: `${prefix}/never-existed` },
          ],
          Quiet: true,
        },
      }),
    );
    await server.send(
      new DeleteObjectsCommand({
        Bucket: publicBucket,
        // The anonymous write is removed too, in case the bucket wrongly accepted it.
        Delete: { Objects: [{ Key: publicKey }, { Key: anonymousKey }], Quiet: true },
      }),
    );
    return (res.Errors ?? []).length === 0 && !(await exists(privateBucket, finalKey));
  });
}

main()
  .then(() => {
    if (failures.length > 0) {
      console.error(`\n${failures.length} check(s) failed. This store is not safe to use as is.`);
      process.exit(1);
    }
    console.info(
      skipped > 0 ? `\nAll checks passed (${skipped} skipped).` : '\nAll checks passed.',
    );
  })
  .catch((err) => {
    console.error('storage:check could not run:', err);
    process.exit(1);
  });
