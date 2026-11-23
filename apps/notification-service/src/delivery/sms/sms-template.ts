import type { Locale } from '../../types/notification-type';

/**
 * An SMS template registered in advance with the telecom registry, per language. A commercial
 * SMS must match one exactly: the request names the registration and gives the variable
 * values, and the text is never sent as free copy.
 */
export interface SmsTemplate<P> {
  /** Names the registration in configuration (`SMS_TEMPLATE_IDS`), with the language: `KEY:en`. */
  key: string;
  /** The registered text per language, with `{{1}}`, `{{2}}`, … where a variable goes. */
  body: Record<Locale, string>;
  /** Values for `{{1}}`, `{{2}}`, … in order, before any shortening. */
  variables(params: P, locale: Locale): string[];
  /**
   * Positions (1-based) whose value is useless when shortened: a code, a password, a username.
   * A value there that does not fit refuses the send.
   */
  exactPositions: readonly number[];
  /** Message parts the registration allows per language; a test keeps the longest text inside it. */
  maxSegments: Record<Locale, number>;
}

/** A message ready to be matched to its registration. Built per send, never stored. */
export interface SmsDraft {
  /** `<template key>:<language>`. */
  registrationKey: string;
  variables: string[];
  /** True when the text needs the 16-bit alphabet (Hindi): parts are then 70 characters, not 160. */
  unicode: boolean;
}

/** A draft with the registration id the provider needs. */
export interface SmsSend extends SmsDraft {
  templateId: string;
}

/** The registry's limit for one variable. */
export const SMS_VARIABLE_MAX = 30;
const CUT_MARK = '..';

/** A value that cannot be sent as registered; the send is refused, not shortened. */
export class SmsVariableError extends Error {
  constructor(readonly position: number) {
    super(
      `SMS variable ${position} must be exact and is longer than ${SMS_VARIABLE_MAX} characters`,
    );
    this.name = 'SmsVariableError';
  }
}

/**
 * Fits each value into the variable limit. An ordinary value is cut and marked with `..`
 * (plain characters, so an English message stays in the 7-bit alphabet). An exact value is never
 * cut: one that does not fit throws, because a shortened code, password or username is wrong.
 */
export function fitVariables(
  values: readonly string[],
  exactPositions: readonly number[],
): string[] {
  return values.map((raw, index) => {
    const position = index + 1;
    const value = raw.replace(/[\r\n\t]+/g, ' ').trim();
    if ([...value].length <= SMS_VARIABLE_MAX) return value;
    if (exactPositions.includes(position)) throw new SmsVariableError(position);
    return `${[...value]
      .slice(0, SMS_VARIABLE_MAX - CUT_MARK.length)
      .join('')
      .trimEnd()}${CUT_MARK}`;
  });
}

// The 7-bit alphabet of SMS; a few characters cost two.
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXTENDED = '^{}\\[~]|€';

/** True when every character is in the 7-bit alphabet. */
export function isGsm7(text: string): boolean {
  return [...text].every((c) => GSM_BASIC.includes(c) || GSM_EXTENDED.includes(c));
}

/** How many message parts the text takes: 160/153 characters in 7-bit, 70/67 otherwise. */
export function smsSegments(text: string): number {
  if (isGsm7(text)) {
    const units = [...text].reduce((n, c) => n + (GSM_EXTENDED.includes(c) ? 2 : 1), 0);
    return units <= 160 ? 1 : Math.ceil(units / 153);
  }
  // UTF-16 code units, as the network counts them.
  return text.length <= 70 ? 1 : Math.ceil(text.length / 67);
}

export function toSmsDraft<P>(template: SmsTemplate<P>, params: P, locale: Locale): SmsDraft {
  return {
    registrationKey: `${template.key}:${locale}`,
    variables: fitVariables(template.variables(params, locale), template.exactPositions),
    unicode: !isGsm7(template.body[locale]),
  };
}
