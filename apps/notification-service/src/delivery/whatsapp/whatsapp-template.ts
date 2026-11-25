import type { MessageTemplateCategory } from '@roviq/common-types';
import type { Locale } from '../../types/notification-type';

/**
 * A message template approved by the provider in advance, per language. A business may start
 * a WhatsApp conversation only with one: the request names the template and gives its
 * variables, and the provider renders the text.
 */
export interface WhatsAppTemplate<P> {
  /** The name the template is registered under; the same for every language. */
  name: string;
  category: MessageTemplateCategory;
  /** The approved body per language, with `{{1}}`, `{{2}}`, … where a variable goes. */
  body: Record<Locale, string>;
  /** Values for `{{1}}`, `{{2}}`, … in order. Never empty strings, never a line break or tab. */
  variables(params: P, locale: Locale): string[];
  /**
   * The portal page the template's button opens, as a path without the leading slash
   * (`institute/attendance`). The approved button URL is the portal address plus `{{1}}`.
   */
  buttonPath(params: P): string;
  /** The button's label per language; at most 25 characters, no variable. */
  buttonLabel: Record<Locale, string>;
  /**
   * Params the provider reviews the template with: its example values and button address are
   * this example rendered, so a submission is the same every time.
   */
  example: P;
}

/** The label every template's single button carries. */
export const OPEN_ROVIQ: Record<Locale, string> = { en: 'Open Roviq', hi: 'Roviq खोलें' };

/** What the adapter sends for one message. */
export interface TemplateSend {
  name: string;
  languageCode: Locale;
  category: MessageTemplateCategory;
  bodyVariables: string[];
  buttonPath: string;
}

const PLACEHOLDER = /\{\{(\d+)\}\}/g;

/** Positions a body uses, in order of first appearance. */
export function placeholdersOf(body: string): number[] {
  return [...new Set([...body.matchAll(PLACEHOLDER)].map((m) => Number(m[1])))];
}

/** The text the recipient reads: the approved body with its variables filled in. */
export function renderTemplate(body: string, variables: readonly string[]): string {
  return body.replace(PLACEHOLDER, (whole, position: string) => {
    const value = variables[Number(position) - 1];
    return value === undefined ? whole : value;
  });
}

/** The provider refuses a variable with a line break, a tab or more than four spaces in a row. */
export function cleanVariable(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
  return cleaned === '' ? fallback : cleaned;
}

export function toTemplateSend<P>(
  template: WhatsAppTemplate<P>,
  params: P,
  locale: Locale,
): TemplateSend {
  return {
    name: template.name,
    languageCode: locale,
    category: template.category,
    bodyVariables: template.variables(params, locale),
    buttonPath: template.buttonPath(params),
  };
}

const EVERY_VARIABLE = /\{\{\d+\}\}/gu;

/**
 * Why the provider would refuse a template body, empty when it would not: a body may not start
 * or end with a variable, two variables need a word between them, and a variable needs about
 * three words of fixed text. Checked for every registered template by a unit test.
 */
export function templateBodyProblems(body: string): string[] {
  const problems: string[] = [];
  if (/^[\s\p{P}]*\{\{\d+\}\}/u.test(body)) problems.push('starts with a variable');
  if (/\{\{\d+\}\}[\s\p{P}]*$/u.test(body)) problems.push('ends with a variable');
  if (/\{\{\d+\}\}[\s\p{P}]*\{\{\d+\}\}/u.test(body)) {
    problems.push('two variables with no word between them');
  }
  const variables = body.match(EVERY_VARIABLE)?.length ?? 0;
  const words = body
    .replace(EVERY_VARIABLE, ' ')
    .split(/[\s\p{P}]+/u)
    .filter(Boolean).length;
  if (variables * 3 > words) problems.push('too many variables for its length');
  return problems;
}
