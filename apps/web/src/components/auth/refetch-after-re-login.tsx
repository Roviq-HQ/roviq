'use client';

import { useAuth } from '@roviq/auth';
import { useApolloClient } from '@roviq/graphql';
import * as React from 'react';

/**
 * After the session-expired dialog signs the user back in, reloads every query on screen:
 * one that failed while the session was dead would otherwise keep showing its error.
 */
export function RefetchAfterReLogin() {
  const { sessionRestores } = useAuth();
  const client = useApolloClient();
  const seen = React.useRef(sessionRestores);

  React.useEffect(() => {
    if (sessionRestores === seen.current) return;
    seen.current = sessionRestores;
    void client.refetchQueries({ include: 'active' });
  }, [client, sessionRestores]);

  return null;
}
