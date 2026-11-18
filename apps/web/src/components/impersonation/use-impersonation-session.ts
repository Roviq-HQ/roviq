'use client';

import { decodeJwt, useAuth } from '@roviq/auth';
import { gql, useMutation } from '@roviq/graphql';
import { useI18nField } from '@roviq/i18n';
import * as React from 'react';
import {
  clearImpersonation,
  readImpersonatedUser,
  readImpersonationToken,
} from './impersonation-storage';
import { EndOwnImpersonationDocument } from './use-impersonation-session.generated';

export const END_OWN_IMPERSONATION = gql`
  mutation EndOwnImpersonation($sessionId: String!) {
    endImpersonation(sessionId: $sessionId)
  }
`;

const EXPIRY_CHECK_MS = 10_000;
const AUTO_CLOSE_MS = 3_000;

function tokenExpired(token: string | null): boolean {
  const payload = token ? decodeJwt(token) : null;
  return !payload || Date.now() >= payload.exp * 1000;
}

export interface ImpersonationSession {
  /** This tab acts as another user. */
  active: boolean;
  /** The session is over; the tab is about to close. */
  ended: boolean;
  exiting: boolean;
  /** The session may read but not change anything. */
  readOnly: boolean;
  displayName: string | null;
  exit: () => Promise<void>;
}

/**
 * State of a tab that acts as another user. Call it once per page: the layout does, and
 * hands the result to the banner and to the user menu.
 *
 * The session ends three ways: `exit` (ended on the server first, so it stops showing as
 * active in the audit lists), token expiry, or the server refusing it (`IMPERSONATION_ENDED`,
 * e.g. the reseller was suspended). Each one drops the token from this tab.
 */
export function useImpersonationSession(): ImpersonationSession {
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
  const claims = token ? decodeJwt(token) : null;
  const active = claims?.isImpersonated === true;

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

  // Browsers may refuse window.close(); the banner then keeps a button to close by hand.
  React.useEffect(() => {
    if (!ended) return;
    const timer = setTimeout(() => window.close(), AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [ended]);

  const exit = async () => {
    setExiting(true);
    const sessionId = claims?.impersonationSessionId;
    // An already-ended session refuses this call; the tab ends either way.
    if (sessionId) await endSession({ variables: { sessionId } }).catch(() => undefined);
    finish();
    window.close();
  };

  return {
    active,
    ended,
    exiting,
    readOnly: claims?.impersonationReadOnly === true,
    displayName,
    exit,
  };
}
