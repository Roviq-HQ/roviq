'use client';

import { extractGraphQLErrorCode, isNetworkError } from '@roviq/graphql';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

/**
 * Translated copy for a failed request, never the server's or the browser's own text.
 * Looks the error code up in `namespace` (a page's `errors` group) first, then in `error`;
 * a request that never reached the server gets the network message; anything else `fallback`.
 */
export function useErrorCopy(namespace?: string) {
  const tError = useTranslations('error');
  const tPage = useTranslations(namespace ?? 'error');
  return useCallback(
    (err: unknown, fallback?: string): string => {
      const code = extractGraphQLErrorCode(err);
      if (code) {
        if (namespace && tPage.has(code)) return tPage(code);
        if (tError.has(code)) return tError(code);
      }
      if (isNetworkError(err)) return tError('network');
      return fallback ?? tError('errorDescription');
    },
    [namespace, tError, tPage],
  );
}
