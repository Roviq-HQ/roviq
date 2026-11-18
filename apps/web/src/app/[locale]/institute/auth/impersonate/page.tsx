'use client';

import { extractGraphQLErrorCode, gql, useMutation } from '@roviq/graphql';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { storeImpersonation } from '@web/components/impersonation/impersonation-storage';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { ExchangeImpersonationCodeDocument } from './page.generated';

export const EXCHANGE_IMPERSONATION_CODE = gql`
  mutation ExchangeImpersonationCode($code: String!) {
    exchangeImpersonationCode(code: $code) {
      accessToken
      user {
        id
        username
        firstName
        lastName
      }
    }
  }
`;

/** A code that was already used, never existed or belongs to an ended session. */
const SPENT_CODE_ERRORS = new Set(['IMPERSONATION_CODE_EXPIRED', 'IMPERSONATION_SESSION_INVALID']);

const { impersonationExchange: ids } = testIds;

export default function ImpersonatePage() {
  const tAuth = useTranslations('auth');
  const searchParams = useSearchParams();
  const locale = useLocale();
  const code = searchParams.get('code');
  const [error, setError] = useState<string | null>(null);
  const [exchange] = useMutation(ExchangeImpersonationCodeDocument);
  // The code is single-use: a second run (React strict mode, a re-render) would spend
  // it a second time and show "expired" for a session that just opened.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!code) {
      setError(tAuth('noImpersonationCode'));
      return;
    }

    exchange({ variables: { code } })
      .then(({ data }) => {
        const session = data?.exchangeImpersonationCode;
        if (!session) {
          setError(tAuth('impersonationExchangeFailed'));
          return;
        }
        storeImpersonation(session.accessToken, {
          username: session.user.username,
          firstName: session.user.firstName ?? null,
          lastName: session.user.lastName ?? null,
        });
        // A full load, not router.replace: this tab already restored whatever session the
        // browser holds on this portal, and a client-side move would keep showing that
        // user's menus and permissions while requests carry the impersonation token.
        window.location.replace(`/${locale}/dashboard`);
      })
      .catch((err: unknown) => {
        const errorCode = extractGraphQLErrorCode(err);
        setError(
          errorCode && SPENT_CODE_ERRORS.has(errorCode)
            ? tAuth('codeExpiredOrInvalid')
            : tAuth('impersonationExchangeFailed'),
        );
      });
  }, [code, exchange, locale, tAuth]);

  if (!error) {
    return (
      <div className="flex min-h-screen items-center justify-center" aria-busy="true">
        <p className="text-muted-foreground" data-testid={ids.loading}>
          {tAuth('establishingImpersonation')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{tAuth('impersonationFailed')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p role="alert" className="text-destructive" data-testid={ids.error}>
            {error}
          </p>
          <Button onClick={() => window.close()} variant="outline" data-testid={ids.closeBtn}>
            {tAuth('closeTab')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
