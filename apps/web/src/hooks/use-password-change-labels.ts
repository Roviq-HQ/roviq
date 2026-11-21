'use client';

import type { PasswordChangeFormLabels } from '@roviq/auth';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { useAuthErrorLabels } from './use-auth-error-labels';

/** Translated labels for `<PasswordChangeForm>`, shared by the account pages and the forced change. */
export function usePasswordChangeLabels(): PasswordChangeFormLabels {
  const tAuth = useTranslations('auth');
  const errorLabels = useAuthErrorLabels();
  return React.useMemo<PasswordChangeFormLabels>(
    () => ({
      title: tAuth('passwordChange.title'),
      description: tAuth('passwordChange.description'),
      currentPassword: tAuth('passwordChange.currentPassword'),
      newPassword: tAuth('passwordChange.newPassword'),
      confirmPassword: tAuth('passwordChange.confirmPassword'),
      strengthLabel: tAuth('passwordChange.strengthLabel'),
      strengthWeak: tAuth('passwordChange.strengthWeak'),
      strengthFair: tAuth('passwordChange.strengthFair'),
      strengthGood: tAuth('passwordChange.strengthGood'),
      strengthStrong: tAuth('passwordChange.strengthStrong'),
      submit: tAuth('passwordChange.submit'),
      submitting: tAuth('passwordChange.submitting'),
      showPassword: tAuth('passwordChange.showPassword'),
      hidePassword: tAuth('passwordChange.hidePassword'),
      requirementsTitle: tAuth('passwordChange.requirementsTitle'),
      reqMinLength: tAuth('passwordChange.reqMinLength'),
      reqMixedCase: tAuth('passwordChange.reqMixedCase'),
      reqNumber: tAuth('passwordChange.reqNumber'),
      reqDifferent: tAuth('passwordChange.reqDifferent'),
      mustDifferError: tAuth('passwordChange.mustDifferError'),
      minLengthError: tAuth('passwordChange.minLengthError'),
      mixedCaseError: tAuth('passwordChange.mixedCaseError'),
      numberError: tAuth('passwordChange.numberError'),
      mismatchError: tAuth('passwordChange.mismatchError'),
      requiredError: tAuth('passwordChange.requiredError'),
      successMessage: tAuth('passwordChange.successMessage'),
      genericError: tAuth('passwordChange.genericError'),
      errors: errorLabels,
    }),
    [tAuth, errorLabels],
  );
}
