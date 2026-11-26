import type { ConfigService } from '@nestjs/config';
import { createMock } from '@roviq/testing';
import { describe, expect, it, vi } from 'vitest';
import { S3StorageClient } from '../s3-storage-client';

const VALUES: Record<string, string> = {
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY: 'test-access-key',
  S3_SECRET_KEY: 'test-secret-key',
  S3_ENDPOINT: 'http://storage.internal:9000',
  S3_PUBLIC_ENDPOINT: 'https://storage.example.test',
  S3_BUCKET_PRIVATE: 'files-private',
  S3_BUCKET_PUBLIC: 'files-public',
  S3_PUBLIC_BASE_URL: 'https://files.example.test',
};

function client(): S3StorageClient {
  const config = createMock<ConfigService>({
    getOrThrow: vi.fn((key: string) => {
      const value = VALUES[key];
      if (value === undefined) throw new Error(`missing ${key}`);
      return value;
    }),
  });
  return new S3StorageClient(config);
}

describe('S3StorageClient presigned URLs', () => {
  it('should sign exactly content-length, content-type and host on an upload URL', async () => {
    const { url } = await client().presignPut('private', 'pending/a/b.pdf', {
      contentType: 'application/pdf',
      contentLength: 1234,
      expiresInSeconds: 300,
    });

    expect(new URL(url).searchParams.get('X-Amz-SignedHeaders')).toBe(
      'content-length;content-type;host',
    );
  });

  it('should put no checksum parameter on an upload URL', async () => {
    const { url } = await client().presignPut('private', 'pending/a/b.pdf', {
      contentType: 'application/pdf',
      contentLength: 1234,
      expiresInSeconds: 300,
    });

    const checksumParams = [...new URL(url).searchParams.keys()].filter((name) =>
      /checksum/i.test(name),
    );
    expect(checksumParams).toEqual([]);
  });

  it('should sign the upload URL for the browser endpoint and the private bucket', async () => {
    const { url } = await client().presignPut('private', 'pending/a/b.pdf', {
      contentType: 'application/pdf',
      contentLength: 1234,
      expiresInSeconds: 300,
    });

    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://storage.example.test');
    expect(parsed.pathname).toBe('/files-private/pending/a/b.pdf');
  });

  it('should give the same download URL twice for a fixed signing time', async () => {
    const storage = client();
    const options = {
      expiresInSeconds: 3600,
      signingDate: new Date('2026-11-26T06:00:00.000Z'),
      disposition: { type: 'attachment' as const, filename: 'report.pdf' },
    };

    const first = await storage.presignGet('private', 'institutes/x/report.pdf', options);
    const second = await storage.presignGet('private', 'institutes/x/report.pdf', options);

    expect(second).toBe(first);
    expect(new URL(first).searchParams.get('X-Amz-Date')).toBe('20261126T060000Z');
  });
});
