'use client';

import { extractGraphQLErrorCode } from '@roviq/graphql';
import { useTranslations } from 'next-intl';
import * as React from 'react';

const LINK_ERROR_CODES = [
  'GUARDIAN_ALREADY_LINKED',
  'STUDENT_NOT_FOUND',
  'GUARDIAN_NOT_FOUND',
] as const;
type LinkErrorCode = (typeof LINK_ERROR_CODES)[number];

function isLinkErrorCode(code: string | null): code is LinkErrorCode {
  return LINK_ERROR_CODES.some((known) => known === code);
}

/** Translated copy for a failed `linkGuardianToStudent`, keyed on `extensions.code`. */
export function useLinkErrorMessage() {
  const t = useTranslations('peopleLinks');
  const tError = useTranslations('error');
  return React.useCallback(
    (error: unknown): string => {
      const code = extractGraphQLErrorCode(error);
      return isLinkErrorCode(code) ? t(`linkErrors.${code}`) : tError('errorDescription');
    },
    [t, tError],
  );
}
