import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  contentDisposition,
  type PresignedPut,
  type PresignGetOptions,
  type PresignPutOptions,
  type PutOptions,
  type StorageBucket,
  StorageClient,
  type StoredObjectInfo,
} from './storage-client';

const DELETE_BATCH_SIZE = 1000;

function isNotFound(err: unknown): boolean {
  return err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404;
}

@Injectable()
export class S3StorageClient extends StorageClient {
  private readonly client: S3Client;
  // Presigned URLs are opened by the browser, which cannot reach a Docker-internal endpoint.
  private readonly presignClient: S3Client;
  private readonly buckets: Record<StorageBucket, string>;
  private readonly publicBaseUrl: string;

  constructor(config: ConfigService) {
    super();
    const shared = {
      region: config.getOrThrow<string>('S3_REGION'),
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY'),
        secretAccessKey: config.getOrThrow<string>('S3_SECRET_KEY'),
      },
    };
    this.client = new S3Client({ ...shared, endpoint: config.getOrThrow<string>('S3_ENDPOINT') });
    this.presignClient = new S3Client({
      ...shared,
      endpoint: config.getOrThrow<string>('S3_PUBLIC_ENDPOINT'),
    });
    this.buckets = {
      private: config.getOrThrow<string>('S3_BUCKET_PRIVATE'),
      public: config.getOrThrow<string>('S3_BUCKET_PUBLIC'),
    };
    this.publicBaseUrl = config.getOrThrow<string>('S3_PUBLIC_BASE_URL').replace(/\/+$/, '');
  }

  async presignPut(
    bucket: StorageBucket,
    key: string,
    options: PresignPutOptions,
  ): Promise<PresignedPut> {
    const url = await getSignedUrl(
      this.presignClient,
      new PutObjectCommand({
        Bucket: this.buckets[bucket],
        Key: key,
        ContentType: options.contentType,
        ContentLength: options.contentLength,
      }),
      {
        expiresIn: options.expiresInSeconds,
        // Signing both makes storage reject a body of another size or type.
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
    return { url, headers: { 'Content-Type': options.contentType } };
  }

  presignGet(bucket: StorageBucket, key: string, options: PresignGetOptions): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new GetObjectCommand({
        Bucket: this.buckets[bucket],
        Key: key,
        ...(options.disposition && {
          ResponseContentDisposition: contentDisposition(
            options.disposition.type,
            options.disposition.filename,
          ),
        }),
      }),
      {
        expiresIn: options.expiresInSeconds,
        ...(options.signingDate && { signingDate: options.signingDate }),
      },
    );
  }

  publicUrl(key: string): string {
    return `${this.publicBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  async put(bucket: StorageBucket, key: string, body: Buffer, options: PutOptions): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.buckets[bucket],
        Key: key,
        Body: body,
        ContentType: options.contentType,
        ...(options.cacheControl && { CacheControl: options.cacheControl }),
      }),
    );
  }

  async copy(
    from: { bucket: StorageBucket; key: string },
    to: { bucket: StorageBucket; key: string },
  ): Promise<void> {
    const sourceKey = from.key.split('/').map(encodeURIComponent).join('/');
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.buckets[to.bucket],
        Key: to.key,
        CopySource: `${this.buckets[from.bucket]}/${sourceKey}`,
      }),
    );
  }

  async head(bucket: StorageBucket, key: string): Promise<StoredObjectInfo | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.buckets[bucket], Key: key }),
      );
      return {
        size: res.ContentLength ?? 0,
        contentType: res.ContentType ?? 'application/octet-stream',
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async getRange(bucket: StorageBucket, key: string, start: number, end: number): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.buckets[bucket],
        Key: key,
        Range: `bytes=${start}-${end}`,
      }),
    );
    return this.toBuffer(res.Body, key);
  }

  async get(bucket: StorageBucket, key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.buckets[bucket], Key: key }),
    );
    return this.toBuffer(res.Body, key);
  }

  async delete(bucket: StorageBucket, keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
      const batch = keys.slice(i, i + DELETE_BATCH_SIZE);
      const res = await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.buckets[bucket],
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      const failed = res.Errors ?? [];
      if (failed.length > 0) {
        throw new Error(
          `Failed to delete ${failed.length} object(s) from ${bucket} bucket: ${failed[0]?.Code}`,
        );
      }
    }
  }

  async bucketExists(bucket: StorageBucket): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.buckets[bucket] }));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  private async toBuffer(
    body: { transformToByteArray(): Promise<Uint8Array> } | undefined,
    key: string,
  ): Promise<Buffer> {
    if (!body) throw new Error(`Storage returned no body for ${key}`);
    return Buffer.from(await body.transformToByteArray());
  }
}
