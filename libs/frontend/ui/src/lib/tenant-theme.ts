/**
 * Per-institute theming: convert a tenant's stored brand colour (hex) into the
 * OKLCH CSS custom properties shadcn/ui reads, for BOTH light and dark mode.
 *
 * Why OKLCH: globals.css defines every shadcn token in OKLCH (perceptual
 * lightness), so deriving a readable foreground and a dark-mode variant is a
 * lightness tweak rather than a fragile RGB guess.
 *
 * Why a generated <style> block (not inline vars on :root): inline styles beat
 * both the `:root` and `.dark` selectors on specificity, which would freeze one
 * value across both modes. Emitting `:root { … }` + `.dark { … }` rules lets
 * next-themes' class toggle pick the right value with zero JS on toggle.
 */

/** OKLCH triple. l ∈ [0,1] (perceptual lightness), c ≥ 0 (chroma), h ∈ [0,360). */
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

const HEX_RE = /^#?([0-9a-f]{6})$/i;

export function isValidHexColor(value: string | null | undefined): value is string {
  return typeof value === 'string' && HEX_RE.test(value.trim());
}

/** sRGB → OKLCH. Returns null for malformed input so callers fall back to default. */
export function hexToOklch(hex: string): Oklch | null {
  const m = hex.trim().match(HEX_RE);
  if (!m) return null;
  const int = Number.parseInt(m[1], 16);
  const r = srgbToLinear(((int >> 16) & 0xff) / 255);
  const g = srgbToLinear(((int >> 8) & 0xff) / 255);
  const b = srgbToLinear((int & 0xff) / 255);

  // linear sRGB → LMS (OKLab matrix)
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const labL = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const labA = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const labB = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const c = Math.hypot(labA, labB);
  let h = (Math.atan2(labB, labA) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: labL, c, h };
}

export function formatOklch({ l, c, h }: Oklch): string {
  return `oklch(${round(l)} ${round(c)} ${round(h, 2)})`;
}

/**
 * Foreground that stays readable on `bg`. Uses the same near-black / near-white
 * tokens globals.css ships, switched on a perceptual-lightness threshold.
 */
export function contrastForeground(bg: Oklch): string {
  return bg.l > 0.62 ? 'oklch(0.205 0 0)' : 'oklch(0.985 0 0)';
}

/**
 * Dark-mode variant of a brand colour. A saturated brand hue (e.g. royal blue,
 * L≈0.36) is invisible on a near-black surface, so lift lightness into the
 * 0.58–0.78 band while preserving hue/chroma — the same trick the default dark
 * palette uses (its `--primary` sits at L≈0.92).
 */
export function deriveDarkVariant({ l, c, h }: Oklch): Oklch {
  return { l: clamp(Math.max(l, 0.7), 0.58, 0.78), c, h };
}

/**
 * Build the `<style>` body that re-skins the tenant accent tokens for both
 * modes. Returns null when the colour is missing/invalid so the caller leaves
 * the Roviq default theme untouched.
 *
 * Scope: primary accent only (button bg, focus ring, active sidebar item).
 * Secondary/accent tokens stay neutral on purpose — overriding them risks
 * unreadable hover/disabled states, and the brand signal lives in `--primary`.
 */
export function buildTenantThemeCss(primaryHex: string | null | undefined): string | null {
  if (!isValidHexColor(primaryHex)) return null;
  const light = hexToOklch(primaryHex);
  if (!light) return null;
  const dark = deriveDarkVariant(light);

  return `:root{${accentVars(light)}}\n.dark{${accentVars(dark)}}`;
}

// ── privates ──────────────────────────────────────────────────────────────

function accentVars(color: Oklch): string {
  const value = formatOklch(color);
  const fg = contrastForeground(color);
  // Tokens that carry the institute's brand accent. Mirrors the names in
  // globals.css; sidebar-* keep the rail's active item on-brand too.
  return [
    `--primary:${value}`,
    `--primary-foreground:${fg}`,
    `--ring:${value}`,
    `--sidebar-primary:${value}`,
    `--sidebar-primary-foreground:${fg}`,
    `--sidebar-ring:${value}`,
  ].join(';');
}

function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
