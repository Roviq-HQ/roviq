import { describe, expect, it } from 'vitest';
import { FakeStorageClient } from '../fake-storage-client';
import { contentDisposition } from '../storage-client';

describe('contentDisposition', () => {
  it('should keep an ASCII name in both forms', () => {
    expect(contentDisposition('attachment', 'report.pdf')).toBe(
      'attachment; filename="report.pdf"; filename*=UTF-8\'\'report.pdf',
    );
  });

  it('should replace non-ASCII characters in the fallback and encode them in filename*', () => {
    expect(contentDisposition('inline', 'प्रमाण.pdf')).toBe(
      'inline; filename="______.pdf"; filename*=UTF-8\'\'%E0%A4%AA%E0%A5%8D%E0%A4%B0%E0%A4%AE%E0%A4%BE%E0%A4%A3.pdf',
    );
  });

  it('should not let a quote or backslash break out of the header value', () => {
    expect(contentDisposition('attachment', 'a"b\\c.pdf')).toBe(
      'attachment; filename="a_b_c.pdf"; filename*=UTF-8\'\'a%22b%5Cc.pdf',
    );
  });
});

describe('FakeStorageClient', () => {
  it('should report size and type of a stored object and null for a missing one', async () => {
    const storage = new FakeStorageClient();
    await storage.put('private', 'a/b.csv', Buffer.from('x,y'), { contentType: 'text/csv' });

    expect(await storage.head('private', 'a/b.csv')).toEqual({ size: 3, contentType: 'text/csv' });
    expect(await storage.head('private', 'a/missing.csv')).toBeNull();
    expect(await storage.head('public', 'a/b.csv')).toBeNull();
  });

  it('should return an inclusive byte range', async () => {
    const storage = new FakeStorageClient();
    storage.simulateUpload('private', 'k', Buffer.from('0123456789'), 'text/csv');

    expect((await storage.getRange('private', 'k', 2, 4)).toString()).toBe('234');
  });

  it('should treat deleting a missing object as a success', async () => {
    const storage = new FakeStorageClient();
    storage.simulateUpload('private', 'k', Buffer.from('1'), 'text/csv');

    await storage.delete('private', ['k', 'never-existed']);

    expect(storage.has('private', 'k')).toBe(false);
  });
});
