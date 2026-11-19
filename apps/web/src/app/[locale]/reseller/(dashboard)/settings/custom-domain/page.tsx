'use client';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { Globe } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { SettingsLoadError, SettingsLoading } from '../_components/settings-states';
import { useResellerProfile } from '../use-reseller-settings';

const { resellerSettings } = testIds;
const SUPPORT_EMAIL = 'support@roviq.com';

export default function ResellerCustomDomainPage() {
  const t = useTranslations('resellerSettings.customDomain');
  const { data, loading, error, refetch } = useResellerProfile();
  const profile = data?.resellerMyProfile;

  // The address the person is actually using; known only in the browser.
  const [currentHost, setCurrentHost] = React.useState('');
  React.useEffect(() => setCurrentHost(window.location.host), []);

  if (!profile && loading) return <SettingsLoading />;
  if (!profile || error) return <SettingsLoadError onRetry={() => void refetch()} />;

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="size-5" aria-hidden="true" />
          {t('title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p
          className="rounded-lg border bg-muted/40 p-3 text-sm"
          data-testid={resellerSettings.customDomainNotice}
        >
          {t('comingSoon')}
        </p>

        <p className="text-sm">
          {t('currentUrl')}{' '}
          <span
            className="font-mono font-medium"
            data-testid={resellerSettings.customDomainCurrentUrl}
          >
            {currentHost}
          </span>
        </p>

        <Field>
          <FieldLabel htmlFor="reseller-custom-domain">{t('domainLabel')}</FieldLabel>
          <Input
            id="reseller-custom-domain"
            value={profile.customDomain ?? ''}
            placeholder={t('domainEmpty')}
            disabled
            readOnly
            data-testid={resellerSettings.customDomainInput}
          />
          <FieldDescription>{t('domainHint')}</FieldDescription>
        </Field>

        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
          data-testid={resellerSettings.customDomainSupportLink}
        >
          {t('contactSupport')}
        </a>
      </CardContent>
    </Card>
  );
}
