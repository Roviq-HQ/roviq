import { describe, expect, it } from 'vitest';
import {
  appendBounded,
  appendLagSample,
  type LagSample,
  lagSeries,
  mergeSystemHealth,
} from '../_lib/health-state';
import type { AdminSystemHealthQuery } from '../_lib/system-health.graphql.generated';

type Health = AdminSystemHealthQuery['adminSystemHealth'];

function makeHealth(checkedAt: string, overrides: Partial<Health> = {}): Health {
  return {
    __typename: 'SystemHealth',
    services: [
      {
        __typename: 'ServiceHealth',
        name: 'REDIS',
        status: 'HEALTHY',
        responseMs: 3,
        uptimePercent: 100,
        checkedAt,
      },
    ],
    natsStreams: [{ __typename: 'NatsStreamLag', name: 'INSTITUTE', consumerLag: 0 }],
    connections: { __typename: 'ConnectionStats', websocket: 1, http: 0 },
    alerts: [],
    alertsAvailable: true,
    dlqPendingCount: 0,
    checkedAt,
    ...overrides,
  };
}

describe('mergeSystemHealth', () => {
  const initial: AdminSystemHealthQuery = {
    __typename: 'Query',
    adminSystemHealth: makeHealth('2026-11-18T10:00:00.000Z'),
  };

  it('should replace the cached snapshot with a newer push', () => {
    const pushed = makeHealth('2026-11-18T10:00:15.000Z', { dlqPendingCount: 3 });

    const merged = mergeSystemHealth(initial, {
      __typename: 'Subscription',
      adminSystemHealthUpdated: pushed,
    });

    expect(merged).toEqual({ __typename: 'Query', adminSystemHealth: pushed });
  });

  it('should keep the cached snapshot when the push is older', () => {
    const stale = makeHealth('2026-11-18T09:59:45.000Z', { dlqPendingCount: 9 });

    const merged = mergeSystemHealth(initial, {
      __typename: 'Subscription',
      adminSystemHealthUpdated: stale,
    });

    expect(merged).toBe(initial);
  });

  it('should keep the cached snapshot when the push carries no data', () => {
    expect(mergeSystemHealth(initial, undefined)).toBe(initial);
  });
});

describe('appendLagSample', () => {
  it('should record each stream lag keyed by stream name', () => {
    const history = appendLagSample(
      [],
      makeHealth('t1', {
        natsStreams: [
          { __typename: 'NatsStreamLag', name: 'INSTITUTE', consumerLag: 4 },
          { __typename: 'NatsStreamLag', name: 'BILLING', consumerLag: 0 },
        ],
      }),
    );

    expect(history).toEqual([{ checkedAt: 't1', lags: { INSTITUTE: 4, BILLING: 0 } }]);
  });

  it('should ignore a repeat of the last snapshot', () => {
    const first = appendLagSample([], makeHealth('t1'));
    expect(appendLagSample(first, makeHealth('t1'))).toEqual(first);
  });

  it('should keep only the newest samples up to the limit', () => {
    let history: LagSample[] = [];
    for (const at of ['t1', 't2', 't3', 't4'])
      history = appendLagSample(history, makeHealth(at), 3);

    expect(history.map((s) => s.checkedAt)).toEqual(['t2', 't3', 't4']);
  });
});

describe('lagSeries', () => {
  it('should skip samples taken before a stream appeared', () => {
    const history: LagSample[] = [
      { checkedAt: 't1', lags: { INSTITUTE: 1 } },
      { checkedAt: 't2', lags: { INSTITUTE: 2, BILLING: 7 } },
      { checkedAt: 't3', lags: { INSTITUTE: 0, BILLING: 5 } },
    ];

    expect(lagSeries(history, 'BILLING')).toEqual([7, 5]);
    expect(lagSeries(history, 'INSTITUTE')).toEqual([1, 2, 0]);
    expect(lagSeries(history, 'MISSING')).toEqual([]);
  });
});

describe('appendBounded', () => {
  it('should drop the oldest values beyond the limit', () => {
    expect(appendBounded([1, 2, 3], 4, 3)).toEqual([2, 3, 4]);
  });
});
