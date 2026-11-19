import {
  type PresignedPut,
  type PresignGetOptions,
  type PresignPutOptions,
  type PutOptions,
  type StorageBucket,
  StorageClient,
  type StoredObjectInfo,
} from './storage-client';

interface FakeObject {
  body: Buffer;
  contentType: string;
  cacheControl?: string;
}

/** In-memory StorageClient for unit tests. */
export class FakeStorageClient extends StorageClient {
  private readonly objects = new Map<string, FakeObject>();

  private id(bucket: StorageBucket, key: string): string {
    return `${bucket}/${key}`;
  }

  /** Stands in for the browser PUT that follows `presignPut`. */
  simulateUpload(bucket: StorageBucket, key: string, body: Buffer, contentType: string): void {
    this.objects.set(this.id(bucket, key), { body, contentType });
  }

  has(bucket: StorageBucket, key: string): boolean {
    return this.objects.has(this.id(bucket, key));
  }

  async presignPut(
    bucket: StorageBucket,
    key: string,
    options: PresignPutOptions,
  ): Promise<PresignedPut> {
    return {
      url: `fake://${this.id(bucket, key)}?put&length=${options.contentLength}`,
      headers: { 'Content-Type': options.contentType },
    };
  }

  async presignGet(
    bucket: StorageBucket,
    key: string,
    options: PresignGetOptions,
  ): Promise<string> {
    const at = options.signingDate ? options.signingDate.getTime() : 'now';
    return `fake://${this.id(bucket, key)}?get&expires=${options.expiresInSeconds}&at=${at}`;
  }

  publicUrl(key: string): string {
    return `fake://public/${key}`;
  }

  async put(bucket: StorageBucket, key: string, body: Buffer, options: PutOptions): Promise<void> {
    this.objects.set(this.id(bucket, key), {
      body,
      contentType: options.contentType,
      cacheControl: options.cacheControl,
    });
  }

  async head(bucket: StorageBucket, key: string): Promise<StoredObjectInfo | null> {
    const object = this.objects.get(this.id(bucket, key));
    return object ? { size: object.body.length, contentType: object.contentType } : null;
  }

  async getRange(bucket: StorageBucket, key: string, start: number, end: number): Promise<Buffer> {
    return (await this.get(bucket, key)).subarray(start, end + 1);
  }

  async get(bucket: StorageBucket, key: string): Promise<Buffer> {
    const object = this.objects.get(this.id(bucket, key));
    if (!object) throw new Error(`No such object: ${this.id(bucket, key)}`);
    return object.body;
  }

  async delete(bucket: StorageBucket, keys: string[]): Promise<void> {
    for (const key of keys) this.objects.delete(this.id(bucket, key));
  }

  async bucketExists(): Promise<boolean> {
    return true;
  }
}
