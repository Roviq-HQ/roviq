import assert from 'node:assert';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GetAccountLocaleDocument, SaveAccountLocaleDocument } from './__generated__/graphql';
import {
  loginAsInstituteAdmin,
  loginAsPlatformAdmin,
  loginAsReseller,
  loginAsTeacher,
} from './helpers/auth';
import { gql } from './helpers/gql-client';

const accounts = [
  { scope: 'platform', login: loginAsPlatformAdmin },
  { scope: 'reseller', login: loginAsReseller },
  { scope: 'institute', login: loginAsInstituteAdmin },
];

describe.each(accounts)('Account language ($scope)', ({ login }) => {
  let token: string;
  let otherToken: string;
  let originalLocale: string | null;
  let otherLocale: string | null;
  let preferenceLoaded = false;

  beforeAll(async () => {
    token = (await login()).accessToken;
    otherToken = (await loginAsTeacher()).accessToken;
    const original = await gql(GetAccountLocaleDocument, {}, token);
    expect(original.errors).toBeUndefined();
    assert(original.data);
    originalLocale = original.data.myPreferredLocale;
    preferenceLoaded = true;
    const other = await gql(GetAccountLocaleDocument, {}, otherToken);
    expect(other.errors).toBeUndefined();
    assert(other.data);
    otherLocale = other.data.myPreferredLocale;
  });

  afterAll(async () => {
    if (!preferenceLoaded) return;
    const restored = await gql(
      SaveAccountLocaleDocument,
      { input: { locale: originalLocale } },
      token,
    );
    expect(restored.errors).toBeUndefined();
  });

  it('should persist supported languages and restore browser detection without changing another account', async () => {
    for (const locale of ['hi', 'en', null]) {
      const saved = await gql(SaveAccountLocaleDocument, { input: { locale } }, token);
      expect(saved.errors).toBeUndefined();
      expect(saved.data?.updateMyPreferredLocale).toBe(locale);
      const loaded = await gql(GetAccountLocaleDocument, {}, token);
      expect(loaded.errors).toBeUndefined();
      expect(loaded.data?.myPreferredLocale).toBe(locale);
      const other = await gql(GetAccountLocaleDocument, {}, otherToken);
      expect(other.errors).toBeUndefined();
      expect(other.data?.myPreferredLocale).toBe(otherLocale);
    }
  });

  it('should reject unsupported languages and preserve the current preference', async () => {
    const before = await gql(GetAccountLocaleDocument, {}, token);
    expect(before.errors).toBeUndefined();
    const result = await gql(SaveAccountLocaleDocument, { input: { locale: 'fr' } }, token);
    expect(result.errors?.map((error) => error.extensions?.code)).toEqual(['BAD_REQUEST']);
    const after = await gql(GetAccountLocaleDocument, {}, token);
    expect(after.errors).toBeUndefined();
    expect(after.data).toEqual(before.data);
  });
});

describe('Account language authentication', () => {
  it('should reject anonymous reads and writes', async () => {
    const read = await gql(GetAccountLocaleDocument, {});
    expect(read.errors?.map((error) => error.extensions?.code)).toEqual(['UNAUTHENTICATED']);
    const write = await gql(SaveAccountLocaleDocument, { input: { locale: 'hi' } });
    expect(write.errors?.map((error) => error.extensions?.code)).toEqual(['UNAUTHENTICATED']);
  });
});
