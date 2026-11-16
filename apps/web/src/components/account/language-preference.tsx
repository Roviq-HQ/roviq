'use client';

import { useAuth } from '@roviq/auth';
import { localeLabels, locales, usePathname, useRouter } from '@roviq/i18n';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { resolveAccountLocale } from '@web/lib/account-locale';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

const { accountLocale } = testIds;

export function LanguagePreference() {
  const {
    user,
    preferredLocale,
    isLocaleLoading,
    localePreferenceError,
    reloadPreferredLocale,
    savePreferredLocale,
    isImpersonated,
  } = useAuth();
  const t = useTranslations('account.language');
  const router = useRouter();
  const pathname = usePathname();
  const [pending, setPending] = useState(false);

  function save(value: string) {
    const locale = value === 'browser' ? null : value;
    setPending(true);
    savePreferredLocale(locale)
      .then(
        () => {
          toast.success(t('saved'));
          router.replace(`${pathname}${window.location.search}${window.location.hash}`, {
            locale: resolveAccountLocale(locale, navigator.languages),
          });
        },
        () => toast.error(t('saveFailed')),
      )
      .finally(() => setPending(false));
  }

  return (
    <Card data-testid={accountLocale.card}>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Field>
          <FieldLabel htmlFor="account-language">{t('label')}</FieldLabel>
          <Select
            value={preferredLocale ?? 'browser'}
            onValueChange={save}
            disabled={
              !user || pending || isLocaleLoading || localePreferenceError || isImpersonated
            }
          >
            <SelectTrigger
              id="account-language"
              data-testid={accountLocale.select}
              aria-busy={pending || isLocaleLoading}
            >
              <SelectValue placeholder={t('label')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="browser" data-testid={accountLocale.option('browser')}>
                {t('browser')}
              </SelectItem>
              {locales.map((locale) => (
                <SelectItem key={locale} value={locale} data-testid={accountLocale.option(locale)}>
                  {localeLabels[locale]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {pending || isLocaleLoading ? (
            <CardDescription role="status">{t(pending ? 'saving' : 'loading')}</CardDescription>
          ) : null}
          {isImpersonated ? <CardDescription>{t('impersonating')}</CardDescription> : null}
          {localePreferenceError ? (
            <>
              <CardDescription role="alert">{t('loadFailed')}</CardDescription>
              <Button
                type="button"
                variant="outline"
                onClick={reloadPreferredLocale}
                title={t('retry')}
                data-testid={accountLocale.retry}
              >
                {t('retry')}
              </Button>
            </>
          ) : null}
        </Field>
      </CardContent>
    </Card>
  );
}
