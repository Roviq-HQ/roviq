'use client';

import { Alert, AlertDescription, AlertTitle } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { ShieldAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * Shown in place of the sections of an account that only its owner may see or change
 * (password, email verification, passkeys, signed-in devices) during an impersonation session.
 */
export function OwnAccountNotice() {
  const t = useTranslations('account.ownAccountNotice');
  return (
    <Alert data-testid={testIds.ownAccountNotice.notice}>
      <ShieldAlert aria-hidden="true" />
      <AlertTitle>{t('title')}</AlertTitle>
      <AlertDescription>
        <p>{t('body')}</p>
        <p>{t('nextStep')}</p>
      </AlertDescription>
    </Alert>
  );
}
