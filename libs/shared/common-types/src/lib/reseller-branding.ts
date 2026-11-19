export const RESELLER_CUSTOM_CSS_MAX_LENGTH = 20_000;

/** Six-digit hex only: the colour picker and the CSS variable preview need this exact form. */
export const RESELLER_BRAND_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

/**
 * Constructs that let a stylesheet load something from another server or leave its
 * `<style>` element. A backslash is refused because CSS escapes can spell any of the
 * others (`\75rl(`).
 */
export const RESELLER_CUSTOM_CSS_FORBIDDEN = [
  { token: '\\', pattern: /\\/ },
  { token: '<', pattern: /</ },
  { token: '@import', pattern: /@import/i },
  { token: 'url(', pattern: /url\s*\(/i },
  { token: 'image-set(', pattern: /image-set\s*\(/i },
  { token: 'image(', pattern: /(^|[^a-z-])image\s*\(/i },
  { token: 'expression(', pattern: /expression\s*\(/i },
  { token: 'javascript:', pattern: /javascript\s*:/i },
] as const;

/** The first forbidden construct found in `css`, or null when the stylesheet is acceptable. */
export function findForbiddenCustomCss(css: string): string | null {
  return RESELLER_CUSTOM_CSS_FORBIDDEN.find(({ pattern }) => pattern.test(css))?.token ?? null;
}

export function isSafeCustomCss(css: string): boolean {
  return css.length <= RESELLER_CUSTOM_CSS_MAX_LENGTH && findForbiddenCustomCss(css) === null;
}
