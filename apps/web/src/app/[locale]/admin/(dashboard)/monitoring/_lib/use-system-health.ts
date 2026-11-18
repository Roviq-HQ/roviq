'use client';

import { useQuery } from '@roviq/graphql';
import * as React from 'react';
import { appendLagSample, type LagSample, mergeSystemHealth } from './health-state';
import {
  AdminSystemHealthDocument,
  AdminSystemHealthUpdatedDocument,
} from './system-health.graphql.generated';

/** Initial snapshot over HTTP, then live pushes merged into the same cached query. */
export function useSystemHealth() {
  const { data, error, loading, refetch, subscribeToMore } = useQuery(AdminSystemHealthDocument);

  React.useEffect(
    () =>
      subscribeToMore({
        document: AdminSystemHealthUpdatedDocument,
        updateQuery: (_unsafePrevious, options) =>
          options.complete
            ? mergeSystemHealth(options.previousData, options.subscriptionData.data)
            : undefined,
      }),
    [subscribeToMore],
  );

  const health = data?.adminSystemHealth;
  const [lagHistory, setLagHistory] = React.useState<LagSample[]>([]);
  React.useEffect(() => {
    if (health) setLagHistory((h) => appendLagSample(h, health));
  }, [health]);

  return { health, lagHistory, error, loading, refetch };
}
