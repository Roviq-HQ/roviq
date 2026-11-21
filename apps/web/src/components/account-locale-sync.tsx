'use client';

import { useAuth } from '@roviq/auth';
import { usePathname, useRouter } from '@roviq/i18n';
import { resolveAccountLocale } from '@web/lib/account-locale';
import { useLocale } from 'next-intl';
import { useEffect } from 'react';

// Locale navigation remounts providers; remember the account for this document.
let appliedAccount: string | null = null;
// Whether this document has seen nobody signed in: only then is a new account a sign-in.
let sawSignedOut = false;

export function AccountLocaleSync() {
  const { user, isLoading, preferredLocale, isLocaleLoading, localePreferenceError } = useAuth();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!user) {
      if (!isLoading) {
        appliedAccount = null;
        sawSignedOut = true;
      }
      return;
    }
    const account = `${user.scope}:${user.id}`;
    if (appliedAccount === account) return;
    // A session restored on page load keeps the locale the URL names (a deep link, a
    // shared link); the saved language applies on sign-in and on switching accounts.
    if (!sawSignedOut && appliedAccount === null) {
      appliedAccount = account;
      return;
    }
    if (isLocaleLoading || localePreferenceError) return;
    appliedAccount = account;
    const targetLocale = resolveAccountLocale(preferredLocale, navigator.languages);
    if (targetLocale !== locale) {
      router.replace(`${pathname}${window.location.search}${window.location.hash}`, {
        locale: targetLocale,
      });
    }
  }, [
    user,
    isLoading,
    preferredLocale,
    isLocaleLoading,
    localePreferenceError,
    locale,
    router,
    pathname,
  ]);

  return null;
}
