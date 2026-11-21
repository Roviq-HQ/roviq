'use client';

import type { PasskeyManagerLabels } from '@roviq/auth';
import { createAuthMutations, PasskeyManager, PasswordChangeForm } from '@roviq/auth';
import { useFormatDate } from '@roviq/i18n';
import { LanguagePreference } from '@web/components/account/language-preference';
import { useAuthErrorLabels } from '@web/hooks/use-auth-error-labels';
import { usePasswordChangeLabels } from '@web/hooks/use-password-change-labels';
import { parseISO } from 'date-fns';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3005';
const GRAPHQL_HTTP = `${API_URL}/api/graphql`;

const authMutations = createAuthMutations(GRAPHQL_HTTP);

const passkeyMutations = {
  myPasskeys: authMutations.myPasskeys,
  generateRegistrationOptions: authMutations.generatePasskeyRegistrationOptions,
  verifyRegistration: authMutations.verifyPasskeyRegistration,
  removePasskey: authMutations.removePasskey,
};

export default function AccountPage() {
  const t = useTranslations('account');
  const tAuth = useTranslations('auth');
  const errorLabels = useAuthErrorLabels();
  const { format } = useFormatDate();
  const formatDate = React.useCallback((d: string) => format(parseISO(d), 'PP'), [format]);

  const passkeyLabels = React.useMemo<PasskeyManagerLabels>(
    () => ({
      title: tAuth('passkeys'),
      description: tAuth('passkeysDescription'),
      addPasskey: tAuth('addPasskey'),
      removePasskey: tAuth('removePasskey'),
      noPasskeys: tAuth('noPasskeys'),
      passkeyName: tAuth('passkeyName'),
      enterPasskeyName: tAuth('enterPasskeyName'),
      passkeyNameHint: tAuth('passkeyNameHint'),
      confirmPassword: tAuth('confirmPassword'),
      registeredAt: tAuth('registeredAt'),
      lastUsedAt: tAuth('lastUsedAt'),
      never: tAuth('never'),
      backedUp: tAuth('backedUp'),
      cancel: tAuth('cancel'),
      removePasskeyConfirm: tAuth('removePasskeyConfirm'),
      nameTooLong: tAuth('nameTooLong'),
      passkeyPasswordRequired: tAuth('passkeyPasswordRequired'),
      loadFailed: tAuth('passkeysLoadFailed'),
      removeFailed: tAuth('passkeyRemoveFailed'),
      addFailed: tAuth('passkeyAddFailed'),
      errors: errorLabels,
    }),
    [tAuth, errorLabels],
  );

  const passwordChangeLabels = usePasswordChangeLabels();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <div className="grid max-w-2xl gap-6">
        <LanguagePreference />
        <PasskeyManager
          mutations={passkeyMutations}
          labels={passkeyLabels}
          formatDate={formatDate}
        />
        <PasswordChangeForm
          labels={passwordChangeLabels}
          onSuccess={() => toast.success(tAuth('passwordChange.successMessage'))}
        />
      </div>
    </div>
  );
}
