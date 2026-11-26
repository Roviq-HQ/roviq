import type { CORSRule, LifecycleRule } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import {
  mergeRules,
  PORTAL_CORS_RULE_ID,
  parseOrigins,
  portalCorsRule,
  privateBucketLifecycle,
  publicBucketLifecycle,
  ruleDifferences,
  STORAGE_CHECK_PREFIX,
  storageCredentials,
  storagePlan,
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
      ID: PORTAL_CORS_RULE_ID,
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

describe('storagePlan', () => {
  it('should put the CORS rule on the private bucket only and lifecycle rules on both', () => {
    const plan = storagePlan({
      privateBucket: 'files-private',
      publicBucket: 'files-public',
      origins: ['https://a.example'],
    });

    expect(plan).toEqual([
      {
        bucket: 'files-private',
        cors: [portalCorsRule(['https://a.example'])],
        lifecycle: privateBucketLifecycle(),
      },
      { bucket: 'files-public', cors: [], lifecycle: publicBucketLifecycle() },
    ]);
  });
});

describe('mergeRules', () => {
  const replication: LifecycleRule = {
    ID: 'expire-old-versions',
    Status: 'Enabled',
    Filter: { Prefix: '' },
    NoncurrentVersionExpiration: { NoncurrentDays: 30 },
  };
  const unnamed: LifecycleRule = {
    Status: 'Enabled',
    Filter: { Prefix: 'tmp/' },
    Expiration: { Days: 7 },
  };
  const staleOurs: LifecycleRule = {
    ID: 'expire-abandoned-uploads',
    Status: 'Enabled',
    Filter: { Prefix: 'pending/' },
    Expiration: { Days: 30 },
  };

  it('should keep rules with other ids and rules without an id, and replace ours by id', () => {
    const result = mergeRules([replication, unnamed, staleOurs], privateBucketLifecycle());

    expect(result.kept).toEqual([replication, unnamed]);
    expect(result.rules).toEqual([replication, unnamed, ...privateBucketLifecycle()]);
  });

  it('should drop an unnamed copy of one of our rules', () => {
    const { ID: _id, ...rest } = portalCorsRule(['https://a.example']);
    const unnamedCopy: CORSRule = rest;
    const foreign: CORSRule = {
      AllowedOrigins: ['https://other.example'],
      AllowedMethods: ['GET'],
    };

    const result = mergeRules([unnamedCopy, foreign], [portalCorsRule(['https://a.example'])]);

    expect(result.kept).toEqual([foreign]);
    expect(result.rules).toEqual([foreign, portalCorsRule(['https://a.example'])]);
  });

  it('should write only ours to a bucket that had none', () => {
    expect(mergeRules([], publicBucketLifecycle())).toEqual({
      rules: publicBucketLifecycle(),
      kept: [],
    });
  });
});

describe('ruleDifferences', () => {
  const planned = storagePlan({
    privateBucket: 'p',
    publicBucket: 'q',
    origins: ['https://a.example', 'https://b.example'],
  })[0];
  if (!planned) throw new Error('plan has no private bucket');

  it('should accept rules a store returns in another shape with the same meaning', () => {
    const appliedLifecycle: LifecycleRule[] = planned.lifecycle.map((rule) => ({
      ...rule,
      Filter: undefined,
      Prefix: rule.Filter?.Prefix,
    }));
    const appliedCors: CORSRule[] = [
      {
        AllowedOrigins: ['https://b.example', 'https://a.example'],
        AllowedMethods: ['GET', 'PUT'],
        AllowedHeaders: ['content-type'],
        ExposeHeaders: ['ETag'],
        MaxAgeSeconds: 3600,
      },
    ];

    expect(
      ruleDifferences({
        plannedCors: planned.cors,
        appliedCors,
        plannedLifecycle: planned.lifecycle,
        appliedLifecycle,
      }),
    ).toEqual([]);
  });

  it('should name a lifecycle rule the store dropped part of, and a missing CORS rule', () => {
    const appliedLifecycle = planned.lifecycle.map((rule) =>
      rule.ID === 'expire-abandoned-uploads' ? { ...rule, Expiration: undefined } : rule,
    );

    expect(
      ruleDifferences({
        plannedCors: planned.cors,
        appliedCors: [],
        plannedLifecycle: planned.lifecycle,
        appliedLifecycle,
      }),
    ).toEqual([`CORS rule ${PORTAL_CORS_RULE_ID}`, 'lifecycle rule expire-abandoned-uploads']);
  });
});

describe('storageCredentials', () => {
  it('passes a session token from a temporary sign-in to the client', () => {
    expect(
      storageCredentials({ accessKeyId: 'AKIA1', secretAccessKey: 's', sessionToken: 'tok' }),
    ).toEqual({ accessKeyId: 'AKIA1', secretAccessKey: 's', sessionToken: 'tok' });
  });

  it('leaves the session token out for a static key', () => {
    for (const sessionToken of [undefined, '']) {
      const credentials = storageCredentials({
        accessKeyId: 'AKIA1',
        secretAccessKey: 's',
        sessionToken,
      });
      expect(credentials).toEqual({ accessKeyId: 'AKIA1', secretAccessKey: 's' });
      expect('sessionToken' in credentials).toBe(false);
    }
  });
});
