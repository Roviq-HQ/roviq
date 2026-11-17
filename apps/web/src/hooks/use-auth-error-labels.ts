'use client';

import { AUTH_CLIENT_ERROR_KINDS, AUTH_ERROR_CODES, type AuthErrorLabels } from '@roviq/auth';
import { useTranslations } from 'next-intl';
import * as React from 'react';

const AUTH_ERROR_KEYS = [
  ...AUTH_ERROR_CODES,
  ...AUTH_CLIENT_ERROR_KINDS,
  'generic',
  'retry',
] as const;

/** Translated copy for every auth error, for the `errors` label of `@roviq/auth` components. */
export function useAuthErrorLabels(): AuthErrorLabels {
  const t = useTranslations('auth.errors');
  return React.useMemo(() => Object.fromEntries(AUTH_ERROR_KEYS.map((key) => [key, t(key)])), [t]);
}
