'use client';

import { useLocale } from 'next-intl';
import { useCallback } from 'react';
import { type HelpText, resolveHelpText } from './field-help';

/** Picks the active UI locale's copy and fills `{name}` from the topic's `values`. */
export function useHelpText() {
  const locale = useLocale();
  return useCallback(
    (text: HelpText, values?: Readonly<Record<string, string | number>>) =>
      resolveHelpText(text, locale, values),
    [locale],
  );
}
