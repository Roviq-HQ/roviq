import { describe, expect, it } from 'vitest';
import {
  buildPreviewDocument,
  type PreviewInput,
  readableTextOn,
} from '../_components/build-preview-document';

const input: PreviewInput = {
  name: 'Acme Partners',
  logoUrl: null,
  locale: 'en',
  primaryColor: '#0F766E',
  secondaryColor: '#E2E8F0',
  theme: 'LIGHT',
  customCss: '',
  labels: {
    dashboard: 'Dashboard',
    institutes: 'Institutes',
    team: 'Team',
    settings: 'Settings',
    heading: 'Welcome back',
    body: 'Sample text',
    button: 'Add institute',
  },
};

describe('buildPreviewDocument', () => {
  it('should set the brand colours as CSS variables and show the initials', () => {
    const html = buildPreviewDocument(input);
    expect(html).toContain('--brand-primary:#0F766E');
    expect(html).toContain('--brand-secondary:#E2E8F0');
    expect(html).toContain('<span class="brand-logo">AP</span>');
  });

  it('should show the stored logo instead of the initials, with its address escaped', () => {
    const html = buildPreviewDocument({
      ...input,
      logoUrl: 'http://storage.test/public/logo.webp?a=1&b="x"',
    });
    expect(html).toContain(
      '<img class="brand-logo-image" src="http://storage.test/public/logo.webp?a=1&amp;b=&quot;x&quot;" alt="">',
    );
    expect(html).not.toContain('<span class="brand-logo">');
  });

  it('should fall back to the default colours when a value is not a hex colour', () => {
    const html = buildPreviewDocument({
      ...input,
      primaryColor: 'red;}</style><script>',
      secondaryColor: '',
    });
    expect(html).toContain('--brand-primary:#1677FF');
    expect(html).toContain('--brand-secondary:#F1F5F9');
    expect(html).not.toContain('<script>');
  });

  it('should include an acceptable stylesheet and drop a forbidden one', () => {
    const safe = '.brand-header { letter-spacing: 4px; }';
    expect(buildPreviewDocument({ ...input, customCss: safe })).toContain(`<style>${safe}</style>`);

    const html = buildPreviewDocument({
      ...input,
      customCss: '.a { background: url(https://evil.example/p.png); }',
    });
    expect(html).not.toContain('evil.example');
    expect(html).toContain('<style></style>');
  });

  it('should escape the reseller name and labels', () => {
    const html = buildPreviewDocument({
      ...input,
      name: '<img src=x onerror=alert(1)>',
      labels: { ...input.labels, heading: 'A & B "quoted"' },
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('A &amp; B &quot;quoted&quot;');
  });

  it('should fix the colour scheme for LIGHT and DARK and follow the device for AUTO', () => {
    expect(buildPreviewDocument({ ...input, theme: 'LIGHT' })).toContain('color-scheme:light;');
    expect(buildPreviewDocument({ ...input, theme: 'DARK' })).toContain('color-scheme:dark;');
    const auto = buildPreviewDocument({ ...input, theme: 'AUTO' });
    expect(auto).toContain('color-scheme:light dark;');
    expect(auto).toContain('@media (prefers-color-scheme:dark)');
  });
});

describe('readableTextOn', () => {
  it('should pick white on dark colours and near-black on light ones', () => {
    expect(readableTextOn('#0F766E')).toBe('#ffffff');
    expect(readableTextOn('#000000')).toBe('#ffffff');
    expect(readableTextOn('#F1F5F9')).toBe('#0f172a');
    expect(readableTextOn('#FFFFFF')).toBe('#0f172a');
  });
});
