/** Which of the two buckets an object lives in. */
export type StorageBucket = 'private' | 'public';

export interface PresignPutOptions {
  contentType: string;
  /** Exact byte count. Storage rejects a body of any other size. */
  contentLength: number;
  expiresInSeconds: number;
}

export interface PresignedPut {
  url: string;
  /** Headers the browser must send unchanged; they are part of the signature. */
  headers: Record<string, string>;
}

export interface PresignGetOptions {
  expiresInSeconds: number;
  disposition?: { type: 'inline' | 'attachment'; filename: string };
  /** Fixed signing time, so repeated calls return an identical (cacheable) URL. */
  signingDate?: Date;
}

export interface PutOptions {
  contentType: string;
  cacheControl?: string;
}

export interface StoredObjectInfo {
  size: number;
  contentType: string;
}

export abstract class StorageClient {
  abstract presignPut(
    bucket: StorageBucket,
    key: string,
    options: PresignPutOptions,
  ): Promise<PresignedPut>;

  abstract presignGet(
    bucket: StorageBucket,
    key: string,
    options: PresignGetOptions,
  ): Promise<string>;

  /** Stable URL of an object in the public bucket. */
  abstract publicUrl(key: string): string;

  abstract put(
    bucket: StorageBucket,
    key: string,
    body: Buffer,
    options: PutOptions,
  ): Promise<void>;

  /** Server-side copy; the source and destination may be in different buckets. */
  abstract copy(
    from: { bucket: StorageBucket; key: string },
    to: { bucket: StorageBucket; key: string },
  ): Promise<void>;

  /** Null when the object does not exist. */
  abstract head(bucket: StorageBucket, key: string): Promise<StoredObjectInfo | null>;

  /** Bytes `start`..`end`, both inclusive. */
  abstract getRange(
    bucket: StorageBucket,
    key: string,
    start: number,
    end: number,
  ): Promise<Buffer>;

  abstract get(bucket: StorageBucket, key: string): Promise<Buffer>;

  /** Deleting a missing object is a success. */
  abstract delete(bucket: StorageBucket, keys: string[]): Promise<void>;

  abstract bucketExists(bucket: StorageBucket): Promise<boolean>;
}

/** RFC 6266 header value with an ASCII fallback and a UTF-8 `filename*`. */
export function contentDisposition(type: 'inline' | 'attachment', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
