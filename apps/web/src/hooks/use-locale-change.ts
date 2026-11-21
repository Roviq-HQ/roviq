'use client';

import { useAuth } from '@roviq/auth';
import { usePathname, useRouter } from '@roviq/i18n';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

/** Topbar language switch: saves the account preference first so reloads and new logins keep it. */
export function useLocaleChange() {
  const { user, isImpersonated, savePreferredLocale } = useAuth();
  const t = useTranslations('account.language');
  const router = useRouter();
  const pathname = usePathname();

  return async function changeLocale(locale: string) {
    // An impersonator must not change the impersonated user's saved language.
    if (user && !isImpersonated) {
      try {
        await savePreferredLocale(locale);
      } catch {
        toast.error(t('saveFailed'));
        return;
      }
    }
    router.replace(`${pathname}${window.location.search}${window.location.hash}`, { locale });
  };
}
