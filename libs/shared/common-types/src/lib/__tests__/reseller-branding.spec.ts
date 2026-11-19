import { describe, expect, it } from 'vitest';
import {
  findForbiddenCustomCss,
  isSafeCustomCss,
  RESELLER_BRAND_COLOR_RE,
  RESELLER_CUSTOM_CSS_MAX_LENGTH,
} from '../reseller-branding';

describe('findForbiddenCustomCss', () => {
  it('should accept plain rules, variables, media queries and gradients', () => {
    const css = `
      :root { --brand-radius: 12px; }
      .card { border-radius: var(--brand-radius); background: linear-gradient(#fff, #eee); }
      @media (max-width: 600px) { .sidebar { display: none; } }
    `;
    expect(findForbiddenCustomCss(css)).toBeNull();
    expect(isSafeCustomCss(css)).toBe(true);
  });

  it.each([
    ['@import "https://evil.example/x.css";', '@import'],
    ['@IMPORT url(x.css);', '@import'],
    ['.a { background: url(https://evil.example/p.png); }', 'url('],
    ['.a { background: URL ( "x" ); }', 'url('],
    ['.a { background: image-set("https://evil.example/p.png" 1x); }', 'image-set('],
    ['.a { background: image("https://evil.example/p.png"); }', 'image('],
    ['.a { width: expression(alert(1)); }', 'expression('],
    ['.a { background: javascript:alert(1); }', 'javascript:'],
    ['</style><script>alert(1)</script>', '<'],
    ['.a { background: \\75rl(https://evil.example); }', '\\'],
  ])('should refuse %s', (css, token) => {
    expect(findForbiddenCustomCss(css)).toBe(token);
    expect(isSafeCustomCss(css)).toBe(false);
  });

  it('should not mistake a property ending in "image" for the image() function', () => {
    expect(findForbiddenCustomCss('.a { background-image: none; }')).toBeNull();
  });

  it('should refuse a stylesheet longer than the limit', () => {
    expect(isSafeCustomCss('a'.repeat(RESELLER_CUSTOM_CSS_MAX_LENGTH))).toBe(true);
    expect(isSafeCustomCss('a'.repeat(RESELLER_CUSTOM_CSS_MAX_LENGTH + 1))).toBe(false);
  });
});

describe('RESELLER_BRAND_COLOR_RE', () => {
  it('should accept only six-digit hex colours', () => {
    expect(RESELLER_BRAND_COLOR_RE.test('#1677FF')).toBe(true);
    expect(RESELLER_BRAND_COLOR_RE.test('#abc')).toBe(false);
    expect(RESELLER_BRAND_COLOR_RE.test('1677FF')).toBe(false);
    expect(RESELLER_BRAND_COLOR_RE.test('#1677FF80')).toBe(false);
    expect(RESELLER_BRAND_COLOR_RE.test('red')).toBe(false);
  });
});
