import { BusinessException, ErrorCode } from '@roviq/common-types';
import { describe, expect, it } from 'vitest';
import { PDF_FONT_FAMILIES, PdfService } from '../pdf.service';

const TEMPLATE = `
#set text(font: (${PDF_FONT_FAMILIES.map((family) => `"${family}"`).join(', ')}), fallback: false)
#let d = json("/data.json")
#d.text
`;

/** One sample per bundled font: the PDF must embed that font, or its glyphs are boxes. */
const SAMPLES: ReadonlyArray<{ family: string; embedded: string; text: string }> = [
  { family: 'Noto Sans', embedded: 'NotoSans-Regular', text: 'Transfer Certificate' },
  {
    family: 'Noto Sans Devanagari',
    embedded: 'NotoSansDevanagari-Regular',
    text: 'स्थानांतरण प्रमाण पत्र',
  },
];

describe('PdfService', () => {
  const service = new PdfService();

  it('has a sample for every font family the templates may name', () => {
    expect(SAMPLES.map((sample) => sample.family)).toEqual([...PDF_FONT_FAMILIES]);
  });

  it.each(SAMPLES)('embeds $family for text in its script', ({ embedded, text }) => {
    const pdf = service.render({ template: TEMPLATE, data: { text } });

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain(`+${embedded}`);
  });

  it('refuses text in a script no bundled font covers', () => {
    const render = () => service.render({ template: TEMPLATE, data: { text: 'தமிழ்' } });

    expect(render).toThrow(BusinessException);
    expect(render).toThrow(expect.objectContaining({ code: ErrorCode.PDF_UNSUPPORTED_SCRIPT }));
  });

  it('finds unsupported text nested in lists and objects', () => {
    const assert = () =>
      service.assertRenderable({ rows: [{ label: 'Name', value: 'ਪੰਜਾਬੀ' }], ok: 'fine' });

    expect(assert).toThrow(expect.objectContaining({ code: ErrorCode.PDF_UNSUPPORTED_SCRIPT }));
  });

  it('treats Typst markup in a value as text, never as code', () => {
    // If the value were evaluated, #panic would fail the compile.
    const pdf = service.render({
      template: TEMPLATE,
      data: { text: '#panic("injected") #import "/data.json" $x$ *bold*' },
    });

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('gives each render only its own files', () => {
    const withFile = `#read("/note.txt")`;
    const first = service.render({
      template: withFile,
      data: {},
      files: { '/note.txt': Buffer.from('one') },
    });
    expect(first.subarray(0, 5).toString()).toBe('%PDF-');

    expect(() => service.render({ template: withFile, data: {} })).toThrow(
      'PDF template failed to compile',
    );
  });
});
