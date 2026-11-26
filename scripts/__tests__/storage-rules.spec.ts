import { describe, expect, it } from 'vitest';
import {
  parseOrigins,
  portalCorsRule,
  privateBucketLifecycle,
  publicBucketLifecycle,
  STORAGE_CHECK_PREFIX,
} from '../lib/storage-rules';

describe('parseOrigins', () => {
  it('should split, trim and drop empty entries', () => {
    expect(parseOrigins(' https://a.example , ,https://b.example,')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });
});

describe('portalCorsRule', () => {
  it('should allow upload and download from the portal origins with the Content-Type header', () => {
    expect(portalCorsRule(['https://a.example', 'https://b.example'])).toEqual({
      AllowedOrigins: ['https://a.example', 'https://b.example'],
      AllowedMethods: ['PUT', 'GET'],
      AllowedHeaders: ['Content-Type'],
      ExposeHeaders: ['ETag'],
      MaxAgeSeconds: 3600,
    });
  });

  it('should refuse an empty origin list instead of writing a rule that allows nobody', () => {
    expect(() => portalCorsRule([])).toThrow('ALLOWED_ORIGINS lists no portal origin');
  });
});

describe('bucket lifecycle rules', () => {
  it('should abort unfinished multipart uploads after a day in both buckets', () => {
    for (const rules of [privateBucketLifecycle(), publicBucketLifecycle()]) {
      expect(rules).toContainEqual({
        ID: 'abort-unfinished-multipart',
        Status: 'Enabled',
        Filter: { Prefix: '' },
        AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
      });
    }
  });

  it('should expire abandoned uploads in the private bucket only', () => {
    const expected = {
      ID: 'expire-abandoned-uploads',
      Status: 'Enabled',
      Filter: { Prefix: 'pending/' },
      Expiration: { Days: 2 },
    };
    expect(privateBucketLifecycle()).toContainEqual(expected);
    expect(publicBucketLifecycle().map((rule) => rule.ID)).not.toContain(expected.ID);
  });

  it('should expire objects a storage check left behind in both buckets', () => {
    for (const rules of [privateBucketLifecycle(), publicBucketLifecycle()]) {
      expect(rules).toContainEqual({
        ID: 'expire-storage-check',
        Status: 'Enabled',
        Filter: { Prefix: STORAGE_CHECK_PREFIX },
        Expiration: { Days: 1 },
      });
    }
  });

  it('should never expire stored files outside those prefixes', () => {
    for (const rules of [privateBucketLifecycle(), publicBucketLifecycle()]) {
      const expiring = rules.filter((rule) => rule.Expiration);
      expect(expiring.length).toBeGreaterThan(0);
      for (const rule of expiring) {
        expect(['pending/', STORAGE_CHECK_PREFIX]).toContain(rule.Filter?.Prefix);
      }
    }
  });
});
