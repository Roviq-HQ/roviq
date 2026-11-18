'use client';

import { decodeJwt, useAuth } from '@roviq/auth';
import { gql, useMutation } from '@roviq/graphql';
import { useI18nField } from '@roviq/i18n';
import { Button, Card, CardContent } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { EndOwnImpersonationDocument } from './impersonation-banner.generated';
import {
  clearImpersonation,
  readImpersonatedUser,
  readImpersonationToken,
} from './impersonation-storage';

export const END_OWN_IMPERSONATION = gql`
  mutation EndOwnImpersonation($sessionId: String!) {
    endImpersonation(sessionId: $sessionId)
  }
`;

const EXPIRY_CHECK_MS = 10_000;
const AUTO_CLOSE_MS = 3_000;

const { impersonationBanner: ids } = testIds;

function tokenExpired(token: string | null): boolean {
  const payload = token ? decodeJwt(token) : null;
  return !payload || Date.now() >= payload.exp * 1000;
}

/**
 * Banner for a tab that acts as another user, and the notice once that session is over.
 *
 * The session ends three ways: Exit (ended on the server first, so it stops showing as
 * active in the audit lists), token expiry, or the server refusing it (`IMPERSONATION_ENDED`,
 * e.g. the reseller was suspended). Each one drops the token from this tab. Browsers may
 * refuse `window.close()`, so the notice keeps a button to close the tab by hand.
 */
export function ImpersonationBanner() {
  const t = useTranslations('auth');
  const { impersonationEnded } = useAuth();
  const [token] = React.useState(readImpersonationToken);
  const [ended, setEnded] = React.useState(false);
  const [exiting, setExiting] = React.useState(false);
  const [endSession] = useMutation(EndOwnImpersonationDocument);
  const resolveI18n = useI18nField();
  const [person] = React.useState(readImpersonatedUser);
  const displayName = person
    ? [resolveI18n(person.firstName), resolveI18n(person.lastName)].filter(Boolean).join(' ') ||
      person.username
    : null;
  const active = token !== null && decodeJwt(token)?.isImpersonated === true;

  const finish = React.useCallback(() => {
    clearImpersonation();
    setEnded(true);
  }, []);

  React.useEffect(() => {
    if (active && impersonationEnded) finish();
  }, [active, impersonationEnded, finish]);

  React.useEffect(() => {
    if (!active || ended) return;
    const interval = setInterval(() => {
      if (tokenExpired(readImpersonationToken())) finish();
    }, EXPIRY_CHECK_MS);
    return () => clearInterval(interval);
  }, [active, ended, finish]);

  React.useEffect(() => {
    if (!ended) return;
    const timer = setTimeout(() => window.close(), AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [ended]);

  if (!active) return null;

  const exit = async () => {
    setExiting(true);
    const sessionId = token ? decodeJwt(token)?.impersonationSessionId : undefined;
    // An already-ended session refuses this call; the tab ends either way.
    if (sessionId) await endSession({ variables: { sessionId } }).catch(() => undefined);
    finish();
    window.close();
  };

  if (ended) {
    return (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="impersonation-ended-title"
        data-testid={ids.endedNotice}
      >
        <Card className="w-full max-w-sm">
          <CardContent className="space-y-4 pt-6 text-center">
            <p id="impersonation-ended-title" className="font-medium">
              {t('impersonationSessionEnded')}
            </p>
            <p className="text-sm text-muted-foreground">{t('impersonationTabClosing')}</p>
            <Button variant="outline" onClick={() => window.close()} data-testid={ids.closeBtn}>
              {t('closeTab')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-between bg-amber-500 px-4 py-2 text-black"
      role="status"
      data-testid={ids.banner}
    >
      <span className="font-medium">
        {t('impersonationBanner', { name: displayName ?? t('or') })}
      </span>
      <Button
        variant="outline"
        size="sm"
        className="border-black text-black hover:bg-amber-600"
        onClick={exit}
        disabled={exiting}
        data-testid={ids.exitBtn}
      >
        {t('exitImpersonation')}
      </Button>
    </div>
  );
}
