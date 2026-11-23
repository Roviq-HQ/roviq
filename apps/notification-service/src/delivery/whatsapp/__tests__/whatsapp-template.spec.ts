import { describe, expect, it } from 'vitest';
import { buttonPathOf, clipVariable, nameList } from '../template-variables';
import {
  cleanVariable,
  placeholdersOf,
  renderTemplate,
  toTemplateSend,
  type WhatsAppTemplate,
} from '../whatsapp-template';

describe('placeholdersOf', () => {
  it('should list each position once in order of first appearance', () => {
    expect(placeholdersOf('A {{2}} b {{1}} c {{2}} d {{10}}.')).toEqual([2, 1, 10]);
  });

  it('should return nothing for a body without placeholders', () => {
    expect(placeholdersOf('No variables here.')).toEqual([]);
  });
});

describe('renderTemplate', () => {
  it('should put each variable in its position', () => {
    expect(renderTemplate('Hi {{1}}, your {{2}} is {{1}}.', ['Asha', 'fee'])).toBe(
      'Hi Asha, your fee is Asha.',
    );
  });

  it('should leave a placeholder without a variable as it is', () => {
    expect(renderTemplate('Hi {{1}} and {{3}}.', ['Asha'])).toBe('Hi Asha and {{3}}.');
  });
});

describe('cleanVariable', () => {
  it('should turn line breaks and tabs into one space and trim', () => {
    expect(cleanVariable('  Two days,\r\nfamily\tfunction   now ', 'none')).toBe(
      'Two days, family function now',
    );
  });

  it('should fall back when nothing is left', () => {
    expect(cleanVariable(' \n\t ', 'none')).toBe('none');
  });
});

describe('toTemplateSend', () => {
  const template: WhatsAppTemplate<{ name: string }> = {
    name: 'sample_v1',
    category: 'UTILITY',
    body: { en: 'Hello {{1}}.', hi: 'नमस्ते {{1}}।' },
    variables: (p, locale) => [locale === 'hi' ? `${p.name} जी` : p.name],
    buttonPath: () => 'institute/dashboard',
  };

  it('should name the template, language, category, variables and button path', () => {
    expect(toTemplateSend(template, { name: 'Asha' }, 'hi')).toEqual({
      name: 'sample_v1',
      languageCode: 'hi',
      category: 'UTILITY',
      bodyVariables: ['Asha जी'],
      buttonPath: 'institute/dashboard',
    });
  });
});

describe('buttonPathOf', () => {
  it('should drop the leading slash', () => {
    expect(buttonPathOf('/institute/attendance')).toBe('institute/attendance');
    expect(buttonPathOf('reseller/account')).toBe('reseller/account');
  });
});

describe('clipVariable', () => {
  it('should shorten long text and fall back for empty text', () => {
    expect(clipVariable('a'.repeat(300), 200, 'none')).toBe(`${'a'.repeat(199)}…`);
    expect(clipVariable(null, 200, 'none')).toBe('none');
  });
});

describe('nameList', () => {
  it('should list up to three distinct names and count the rest', () => {
    const names = ['Aarav', 'Diya', 'Aarav', null, 'Kabir', 'Meera', 'Ishaan'];

    expect(nameList(names, 'your ward', 'en')).toBe('Aarav, Diya, Kabir and 2 more');
    expect(nameList(names, 'आपका बच्चा', 'hi')).toBe('Aarav, Diya, Kabir और 2 अन्य');
  });

  it('should fall back when no name is known', () => {
    expect(nameList([null, ' '], 'your ward', 'en')).toBe('your ward');
  });

  it('should stay under 200 characters for very long names', () => {
    const names = Array.from({ length: 8 }, (_, i) => `${String(i)}${'x'.repeat(120)}`);

    expect(nameList(names, 'your ward', 'en').length).toBeLessThan(200);
  });
});
