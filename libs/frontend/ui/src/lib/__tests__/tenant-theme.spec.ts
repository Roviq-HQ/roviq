import { describe, expect, it } from 'vitest';
import {
  buildTenantThemeCss,
  contrastForeground,
  deriveDarkVariant,
  formatOklch,
  hexToOklch,
  isValidHexColor,
  type Oklch,
} from '../tenant-theme';

describe('isValidHexColor', () => {
  it('accepts 6-digit hex with and without leading hash', () => {
    expect(isValidHexColor('#1E40AF')).toBe(true);
    expect(isValidHexColor('1e40af')).toBe(true);
    expect(isValidHexColor('  #059669  ')).toBe(true);
  });

  it('rejects malformed, short, long, and empty values', () => {
    expect(isValidHexColor('#xyz')).toBe(false);
    expect(isValidHexColor('#12345')).toBe(false);
    expect(isValidHexColor('#1234567')).toBe(false);
    expect(isValidHexColor('')).toBe(false);
    expect(isValidHexColor(null)).toBe(false);
    expect(isValidHexColor(undefined)).toBe(false);
  });
});

describe('hexToOklch', () => {
  it('maps pure white to lightness 1, ~zero chroma', () => {
    const white = hexToOklch('#ffffff');
    expect(white).not.toBeNull();
    expect((white as Oklch).l).toBeCloseTo(1, 2);
    expect((white as Oklch).c).toBeCloseTo(0, 3);
  });

  it('maps pure black to lightness 0, ~zero chroma', () => {
    const black = hexToOklch('#000000');
    expect(black).not.toBeNull();
    expect((black as Oklch).l).toBeCloseTo(0, 3);
    expect((black as Oklch).c).toBeCloseTo(0, 3);
  });

  it('maps royal blue (#1E40AF) into the blue hue band with mid-low lightness', () => {
    const blue = hexToOklch('#1E40AF') as Oklch;
    expect(blue).not.toBeNull();
    expect(blue.l).toBeGreaterThan(0.3);
    expect(blue.l).toBeLessThan(0.45);
    expect(blue.c).toBeGreaterThan(0.1); // saturated, not grey
    expect(blue.h).toBeGreaterThan(255); // blue sits ~260–270°
    expect(blue.h).toBeLessThan(290);
  });

  it('is hash-insensitive', () => {
    expect(hexToOklch('1E40AF')).toEqual(hexToOklch('#1E40AF'));
  });

  it('returns null for invalid input', () => {
    expect(hexToOklch('nope')).toBeNull();
    expect(hexToOklch('#12')).toBeNull();
  });
});

describe('formatOklch', () => {
  it('emits a valid oklch() string with bounded precision', () => {
    expect(formatOklch({ l: 0.123456, c: 0.234567, h: 264.98765 })).toBe(
      'oklch(0.1235 0.2346 264.99)',
    );
  });
});

describe('contrastForeground', () => {
  it('returns dark foreground on a light background', () => {
    expect(contrastForeground({ l: 0.9, c: 0, h: 0 })).toBe('oklch(0.205 0 0)');
  });

  it('returns light foreground on a dark background', () => {
    expect(contrastForeground({ l: 0.36, c: 0.15, h: 264 })).toBe('oklch(0.985 0 0)');
  });
});

describe('deriveDarkVariant', () => {
  it('lifts a dark brand colour into the visible band, preserving hue + chroma', () => {
    const src: Oklch = { l: 0.36, c: 0.15, h: 264 };
    const dark = deriveDarkVariant(src);
    expect(dark.l).toBeGreaterThanOrEqual(0.58);
    expect(dark.l).toBeLessThanOrEqual(0.78);
    expect(dark.c).toBe(src.c);
    expect(dark.h).toBe(src.h);
  });

  it('clamps an already-bright colour down into the band', () => {
    expect(deriveDarkVariant({ l: 0.95, c: 0.1, h: 120 }).l).toBeLessThanOrEqual(0.78);
  });
});

describe('buildTenantThemeCss', () => {
  it('emits :root and .dark blocks carrying the accent tokens', () => {
    const css = buildTenantThemeCss('#1E40AF');
    expect(css).not.toBeNull();
    const out = css as string;
    expect(out).toContain(':root{');
    expect(out).toContain('.dark{');
    expect(out).toContain('--primary:');
    expect(out).toContain('--primary-foreground:');
    expect(out).toContain('--ring:');
    expect(out).toContain('--sidebar-primary:');
  });

  it('differs between two institute brand colours', () => {
    expect(buildTenantThemeCss('#1E40AF')).not.toBe(buildTenantThemeCss('#059669'));
  });

  it('returns null for missing or invalid colour so the default theme stands', () => {
    expect(buildTenantThemeCss(null)).toBeNull();
    expect(buildTenantThemeCss(undefined)).toBeNull();
    expect(buildTenantThemeCss('teal')).toBeNull();
  });
});
