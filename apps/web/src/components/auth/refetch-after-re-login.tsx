'use client';

import { useAuth } from '@roviq/auth';
import { useApolloClient, useLiveConnection } from '@roviq/graphql';
import * as React from 'react';

/**
 * After the session-expired dialog signs the user back in, reloads every query on screen (one
 * that failed while the session was dead would otherwise keep showing its error) and restarts
 * the live updates that stopped with the session.
 */
export function RefetchAfterReLogin() {
  const { sessionRestores } = useAuth();
  const client = useApolloClient();
  const { resume, noteRefetched } = useLiveConnection();
  const seen = React.useRef(sessionRestores);

  React.useEffect(() => {
    if (sessionRestores === seen.current) return;
    seen.current = sessionRestores;
    void client.refetchQueries({ include: 'active' });
    noteRefetched();
    resume();
  }, [client, noteRefetched, resume, sessionRestores]);

  return null;
}
