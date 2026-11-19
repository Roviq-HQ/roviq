import { describe, expect, it } from 'vitest';
import {
  compactBranding,
  FQDN_RE,
  HEX_COLOR_RE,
  isBrandingEmpty,
  SLUG_RE,
} from '../reseller-validators';

describe('SLUG_RE', () => {
  it.each([
    ['acme', true],
    ['acme-partners', true],
    ['a1', true],
    ['valid-slug-123', true],
    ['a-b-c', true],
    ['Acme', false], // uppercase
    ['-acme', false], // leading hyphen
    ['acme-', false], // trailing hyphen
    ['acme--two', false], // double hyphen
    ['acme_under', false], // underscore
    ['acme.com', false], // dot
    ['', false], // empty
  ])('slug %s -> %s', (input, ok) => {
    expect(SLUG_RE.test(input)).toBe(ok);
  });
});

describe('HEX_COLOR_RE', () => {
  it.each([
    ['#1677FF', true],
    ['#abcdef', true],
    ['#ABCDEF', true],
    ['#123456', true],
    ['#123', false], // too short
    ['1677FF', false], // missing #
    ['#gg0000', false], // invalid hex
    ['', false],
    ['red', false],
    // defense-in-depth: CSS-injection attempts must be rejected.
    ['red; background-image:url(javascript:alert(1))', false],
    ['#1677FF; background:red', false],
  ])('hex %s -> %s', (input, ok) => {
    expect(HEX_COLOR_RE.test(input)).toBe(ok);
  });
});

describe('FQDN_RE', () => {
  it.each([
    ['portal.acme.com', true],
    ['sub.domain.example.co.in', true],
    ['a1-b2.example.com', true],
    ['acme.co', true],
    // Rejected cases should match the backend @IsFQDN({ require_tld: true }).
    ['localhost', false], // no TLD
    ['.com', false], // no hostname
    ['-acme.com', false], // leading hyphen
    ['acme-.com', false], // trailing hyphen
    ['acme..com', false], // empty label
    ['', false],
    ['acme.c', false], // TLD too short
    ['//portal.acme.com', false], // scheme fragment
  ])('fqdn %s -> %s', (input, ok) => {
    expect(FQDN_RE.test(input)).toBe(ok);
  });
});

describe('isBrandingEmpty', () => {
  it('returns true for null / undefined', () => {
    expect(isBrandingEmpty(null)).toBe(true);
    expect(isBrandingEmpty(undefined)).toBe(true);
  });

  it('returns true when every slot is empty or missing', () => {
    expect(isBrandingEmpty({})).toBe(true);
    expect(isBrandingEmpty({ primaryColor: '', secondaryColor: '' })).toBe(true);
    expect(isBrandingEmpty({ primaryColor: null })).toBe(true);
  });

  it('returns false when any slot has a value', () => {
    expect(isBrandingEmpty({ secondaryColor: '#5BC0EB' })).toBe(false);
    expect(isBrandingEmpty({ primaryColor: '#1677FF' })).toBe(false);
  });
});

describe('compactBranding', () => {
  it('returns undefined when everything is empty (prevents server-side clobber)', () => {
    expect(compactBranding(null)).toBeUndefined();
    expect(compactBranding(undefined)).toBeUndefined();
    expect(compactBranding({})).toBeUndefined();
    expect(compactBranding({ primaryColor: '', secondaryColor: '' })).toBeUndefined();
  });

  it('includes only the populated fields', () => {
    expect(compactBranding({ primaryColor: '#1677FF', secondaryColor: '' })).toEqual({
      primaryColor: '#1677FF',
    });
  });

  it('ignores null fields', () => {
    expect(compactBranding({ primaryColor: null, secondaryColor: '#5BC0EB' })).toEqual({
      secondaryColor: '#5BC0EB',
    });
  });
});
