import {
  isSafeCustomCss,
  RESELLER_BRAND_COLOR_RE,
  type ResellerBrandingTheme,
} from '@roviq/common-types';
import { DEFAULT_PRIMARY_COLOR, DEFAULT_SECONDARY_COLOR } from '../schemas';

export interface PreviewLabels {
  dashboard: string;
  institutes: string;
  team: string;
  settings: string;
  heading: string;
  body: string;
  button: string;
}

export interface PreviewInput {
  name: string;
  locale: string;
  primaryColor: string;
  secondaryColor: string;
  theme: ResellerBrandingTheme;
  customCss: string;
  labels: PreviewLabels;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

const validColor = (value: string, fallback: string) =>
  RESELLER_BRAND_COLOR_RE.test(value) ? value : fallback;

/** White or near-black, whichever reads better on `hex` (WCAG relative luminance). */
export function readableTextOn(hex: string): '#ffffff' | '#0f172a' {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.4 ? '#0f172a' : '#ffffff';
}

const LIGHT = '--page:#ffffff;--text:#0f172a;--muted:#64748b;--border:#e2e8f0;--card:#ffffff;';
const DARK = '--page:#0b1220;--text:#e2e8f0;--muted:#94a3b8;--border:#1e293b;--card:#111a2e;';

function themeCss(theme: ResellerBrandingTheme): string {
  if (theme === 'DARK') return `:root{color-scheme:dark;${DARK}}`;
  if (theme === 'LIGHT') return `:root{color-scheme:light;${LIGHT}}`;
  return `:root{color-scheme:light dark;${LIGHT}}@media (prefers-color-scheme:dark){:root{${DARK}}}`;
}

/**
 * A self-contained page for the sandboxed preview frame. The stylesheet the reseller
 * typed is included only when it passes the same rule the server applies.
 */
export function buildPreviewDocument(input: PreviewInput): string {
  const primary = validColor(input.primaryColor, DEFAULT_PRIMARY_COLOR);
  const secondary = validColor(input.secondaryColor, DEFAULT_SECONDARY_COLOR);
  const customCss = isSafeCustomCss(input.customCss) ? input.customCss : '';
  const { labels } = input;
  const nav = [labels.dashboard, labels.institutes, labels.team, labels.settings]
    .map(
      (label, index) =>
        `<div class="brand-nav-item${index === 0 ? ' is-active' : ''}">${escapeHtml(label)}</div>`,
    )
    .join('');

  return `<!doctype html>
<html lang="${escapeHtml(input.locale)}">
<head>
<meta charset="utf-8">
<style>
${themeCss(input.theme)}
:root{--brand-primary:${primary};--brand-on-primary:${readableTextOn(primary)};--brand-secondary:${secondary};--brand-on-secondary:${readableTextOn(secondary)};}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:13px;background:var(--page);color:var(--text)}
.brand-header{display:flex;align-items:center;gap:10px;height:48px;padding:0 14px;background:var(--brand-primary);color:var(--brand-on-primary);font-weight:600}
.brand-logo{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;background:var(--brand-secondary);color:var(--brand-on-secondary);font-size:11px;font-weight:700}
.brand-layout{display:flex;min-height:calc(100vh - 48px)}
.brand-sidebar{width:120px;padding:10px 8px;background:var(--brand-secondary);color:var(--brand-on-secondary)}
.brand-nav-item{padding:6px 10px;border-radius:6px;margin-bottom:2px}
.brand-nav-item.is-active{background:var(--brand-primary);color:var(--brand-on-primary)}
.brand-main{flex:1;padding:14px}
.brand-card{border:1px solid var(--border);border-radius:8px;padding:14px;background:var(--card)}
.brand-card h1{margin:0 0 6px;font-size:15px}
.brand-card p{margin:0 0 12px;color:var(--muted)}
.brand-button{display:inline-block;padding:7px 12px;border-radius:6px;background:var(--brand-primary);color:var(--brand-on-primary);font-weight:600}
</style>
<style>${customCss}</style>
</head>
<body>
<div class="brand-header"><span class="brand-logo">${escapeHtml(initials(input.name))}</span><span>${escapeHtml(input.name)}</span></div>
<div class="brand-layout">
<div class="brand-sidebar">${nav}</div>
<div class="brand-main"><div class="brand-card"><h1>${escapeHtml(labels.heading)}</h1><p>${escapeHtml(labels.body)}</p><span class="brand-button">${escapeHtml(labels.button)}</span></div></div>
</div>
</body>
</html>`;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}
