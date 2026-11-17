import { describe, expect, it } from 'vitest';
import {
  buildI18nTextOptionalSchema,
  buildI18nTextSchema,
  i18nTextOptionalSchema,
  i18nTextSchema,
} from '../i18n-text-schema';

describe('i18nTextSchema', () => {
  it('accepts valid English-only input', () => {
    const result = i18nTextSchema.safeParse({ en: 'Pro Plan' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ en: 'Pro Plan' });
    }
  });

  it('accepts valid multi-locale input', () => {
    const result = i18nTextSchema.safeParse({ en: 'Pro Plan', hi: 'प्रो प्लान' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ en: 'Pro Plan', hi: 'प्रो प्लान' });
    }
  });

  it('strips empty non-default locale values', () => {
    const result = i18nTextSchema.safeParse({ en: 'Pro Plan', hi: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ en: 'Pro Plan' });
      expect(result.data).not.toHaveProperty('hi');
    }
  });

  it('strips whitespace-only non-default locale values', () => {
    const result = i18nTextSchema.safeParse({ en: 'Pro Plan', hi: '   ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ en: 'Pro Plan' });
    }
  });

  it('rejects empty default locale (en)', () => {
    const result = i18nTextSchema.safeParse({ en: '', hi: 'प्रो प्लान' });
    expect(result.success).toBe(false);
  });

  it('rejects missing default locale', () => {
    const result = i18nTextSchema.safeParse({ hi: 'प्रो प्लान' });
    expect(result.success).toBe(false);
  });

  it('rejects value exceeding 500 chars', () => {
    const result = i18nTextSchema.safeParse({ en: 'a'.repeat(501) });
    expect(result.success).toBe(false);
  });
});

describe('i18nTextOptionalSchema', () => {
  it('accepts undefined', () => {
    const result = i18nTextOptionalSchema.safeParse(undefined);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeUndefined();
  });

  it('validates when present', () => {
    const result = i18nTextOptionalSchema.safeParse({ en: 'Test' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ en: 'Test' });
  });

  it('treats all-empty object as undefined (I18nInput blank state)', () => {
    const result = i18nTextOptionalSchema.safeParse({ en: '', hi: '' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeUndefined();
  });

  it('treats all-undefined values as undefined (I18nInput unregistered)', () => {
    const result = i18nTextOptionalSchema.safeParse({ en: undefined, hi: undefined });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeUndefined();
  });

  it('rejects non-empty input without default locale', () => {
    const result = i18nTextOptionalSchema.safeParse({ hi: 'हिन्दी' });
    expect(result.success).toBe(false);
  });
});

describe('institute default locale validation', () => {
  it('requires both English and the institute default', () => {
    const schema = buildI18nTextSchema('Required', 'ta');
    expect(schema.safeParse({ en: 'Science' }).success).toBe(false);
    expect(schema.safeParse({ ta: 'அறிவியல்' }).success).toBe(false);
    expect(schema.parse({ en: 'Science', ta: 'அறிவியல்', hi: '' })).toEqual({
      en: 'Science',
      ta: 'அறிவியல்',
    });
  });
  it('attaches missing default errors to the corresponding input', () => {
    const result = buildI18nTextSchema('Required', 'ta').safeParse({ en: 'Science' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.path)).toEqual([['ta']]);
  });
  it('keeps blank optional fields optional and validates nonempty fields', () => {
    const schema = buildI18nTextOptionalSchema('ta');
    expect(schema.parse({ en: '', ta: '' })).toBeUndefined();
    expect(schema.safeParse({ en: 'Kumar' }).success).toBe(false);
    expect(schema.parse({ en: 'Kumar', ta: 'குமார்' })).toEqual({ en: 'Kumar', ta: 'குமார்' });
  });
});
