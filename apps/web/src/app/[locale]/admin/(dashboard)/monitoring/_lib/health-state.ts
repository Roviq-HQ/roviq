import type {
  AdminSystemHealthQuery,
  AdminSystemHealthUpdatedSubscription,
  SystemHealthFieldsFragment,
} from './system-health.graphql.generated';

export const LAG_HISTORY_SIZE = 30;
export const CONNECTION_HISTORY_SIZE = 30;

/**
 * `subscribeToMore` reducer: a pushed snapshot replaces the cached one unless it is older
 * (a slow initial query can resolve after the first push).
 */
export function mergeSystemHealth(
  previous: AdminSystemHealthQuery,
  pushed: AdminSystemHealthUpdatedSubscription | undefined,
): AdminSystemHealthQuery {
  const next = pushed?.adminSystemHealthUpdated;
  if (!next) return previous;
  const current = previous.adminSystemHealth;
  if (current && Date.parse(next.checkedAt) < Date.parse(current.checkedAt)) return previous;
  return { ...previous, adminSystemHealth: next };
}

export interface LagSample {
  checkedAt: string;
  lags: Record<string, number>;
}

/** Appends one snapshot's per-stream lag, ignoring a repeat of the last snapshot. */
export function appendLagSample(
  history: readonly LagSample[],
  snapshot: Pick<SystemHealthFieldsFragment, 'checkedAt' | 'natsStreams'>,
  max = LAG_HISTORY_SIZE,
): LagSample[] {
  if (history.at(-1)?.checkedAt === snapshot.checkedAt) return [...history];
  const lags = Object.fromEntries(snapshot.natsStreams.map((s) => [s.name, s.consumerLag]));
  return [...history, { checkedAt: snapshot.checkedAt, lags }].slice(-max);
}

/** Series for one stream, oldest → newest; samples taken before the stream appeared are skipped. */
export function lagSeries(history: readonly LagSample[], stream: string): number[] {
  return history.flatMap((s) => (stream in s.lags ? [s.lags[stream] ?? 0] : []));
}

export function appendBounded<T>(history: readonly T[], value: T, max: number): T[] {
  return [...history, value].slice(-max);
}
