'use client';

import { useAuth } from '@roviq/auth';
import * as React from 'react';

/**
 * True once the signed-in session is known to work on the server. A session restored from
 * storage may have been revoked (institute suspended, password changed elsewhere); sign-in
 * pages redirect on this instead of `isAuthenticated` so a dead session shows the form.
 */
export function useLiveSession(): boolean {
  const { isAuthenticated, verifySession } = useAuth();
  const [live, setLive] = React.useState(false);

  React.useEffect(() => {
    if (!isAuthenticated) {
      setLive(false);
      return;
    }
    let cancelled = false;
    void verifySession().then((ok) => {
      if (!cancelled) setLive(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, verifySession]);

  return live;
}
