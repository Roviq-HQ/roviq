import { BusinessException, type PlatformContext } from '@roviq/common-types';
import { createMock } from '@roviq/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type MetricSample,
  type MetricSeries,
  OpenObserveClient,
  OpenObserveUnavailableError,
} from '../../openobserve.client';
import type { AdminTenantAnalyticsArgs } from '../dto/tenant-analytics.args';
import {
  type TenantActiveUsersRecord,
  TenantAnalyticsRepository,
  type TenantInstituteRecord,
  type TenantStorageRecord,
} from '../repositories/tenant-analytics.repository';
import {
  decodeOffsetCursor,
  encodeOffsetCursor,
  TENANT_API_REQUESTS_SERIES,
  TenantAnalyticsService,
  zeroFillTrend,
} from '../tenant-analytics.service';

const NOW_SEC = 1_800_000_000;
const DAY = 86_400;
const START = NOW_SEC - 6 * DAY;

const CTX: PlatformContext = {
  _scope: 'platform',
  scope: 'platform',
  type: 'access',
  userId: '00000000-0000-4000-8000-0000000000a1',
  membershipId: '00000000-0000-4000-8000-0000000000a2',
  roleId: '00000000-0000-4000-8000-0000000000a3',
};

const INST_A = '00000000-0000-4000-8000-00000000000a';
const INST_B = '00000000-0000-4000-8000-00000000000b';
const INST_C = '00000000-0000-4000-8000-00000000000c';
const RESELLER = '00000000-0000-4000-8000-0000000000f1';

const institutes: TenantInstituteRecord[] = [
  {
    instituteId: INST_A,
    instituteName: { en: 'Banyan Academy' },
    resellerId: RESELLER,
    resellerName: 'Direct',
  },
  {
    instituteId: INST_B,
    instituteName: { en: 'Amber Public', hi: 'एम्बर' },
    resellerId: RESELLER,
    resellerName: 'Direct',
  },
  {
    instituteId: INST_C,
    instituteName: { hi: 'चिनार' },
    resellerId: RESELLER,
    resellerName: 'Direct',
  },
];
const activeUsers: TenantActiveUsersRecord[] = [
  { tenantId: INST_A, activeUsers: 2 },
  { tenantId: INST_C, activeUsers: 9 },
];
const storage: TenantStorageRecord[] = [
  { tenantId: INST_A, storageUsedBytes: 5_000 },
  { tenantId: INST_C, storageUsedBytes: 2_000_000 },
];
const calls: MetricSample[] = [
  { metric: { tenant_id: INST_A }, value: 40.4 },
  { metric: { tenant_id: INST_B }, value: 120 },
];
const trend: MetricSeries[] = [
  {
    metric: { tenant_id: INST_B },
    values: [
      [START + 5 * DAY, 30],
      [START + 6 * DAY, 120],
    ],
  },
];

function args(overrides: Partial<AdminTenantAnalyticsArgs> = {}): AdminTenantAnalyticsArgs {
  return { first: 25, sortBy: 'API_CALLS_24H', sortOrder: 'DESC', ...overrides };
}

describe('TenantAnalyticsService', () => {
  let repo: TenantAnalyticsRepository;
  let openObserve: OpenObserveClient;
  let service: TenantAnalyticsService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_SEC * 1000);
    repo = createMock<TenantAnalyticsRepository>({
      listInstitutes: vi.fn().mockResolvedValue(institutes),
      countActiveUsersSince: vi.fn().mockResolvedValue(activeUsers),
      sumStorageByTenant: vi.fn().mockResolvedValue(storage),
    });
    openObserve = createMock<OpenObserveClient>({
      query: vi.fn().mockResolvedValue(calls),
      queryRange: vi.fn().mockResolvedValue(trend),
    });
    service = new TenantAnalyticsService(repo, openObserve);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should merge DB and OpenObserve data per institute', async () => {
    const result = await service.list(CTX, args());

    expect(result.metricsAvailable).toBe(true);
    expect(result.totalCount).toBe(3);
    expect(result.edges.map((e) => e.node)).toEqual([
      {
        ...institutes[1],
        activeUsers24h: 0,
        storageUsedBytes: 0,
        apiCalls24h: 120,
        activityTrend7d: [0, 0, 0, 0, 0, 30, 120],
      },
      {
        ...institutes[0],
        activeUsers24h: 2,
        storageUsedBytes: 5_000,
        apiCalls24h: 40,
        activityTrend7d: [0, 0, 0, 0, 0, 0, 0],
      },
      {
        ...institutes[2],
        activeUsers24h: 9,
        storageUsedBytes: 2_000_000,
        apiCalls24h: 0,
        activityTrend7d: [0, 0, 0, 0, 0, 0, 0],
      },
    ]);
  });

  it('should sort by storage used, largest first, with unused institutes last', async () => {
    const result = await service.list(CTX, args({ sortBy: 'STORAGE_USED', sortOrder: 'DESC' }));

    expect(result.edges.map((e) => e.node.instituteId)).toEqual([INST_C, INST_A, INST_B]);
  });

  it('should query OpenObserve once for 24h totals and once for a 7-point daily range', async () => {
    await service.list(CTX, args());

    expect(openObserve.query).toHaveBeenCalledWith(
      `sum by (tenant_id) (increase(${TENANT_API_REQUESTS_SERIES}[24h]))`,
    );
    expect(openObserve.queryRange).toHaveBeenCalledWith(
      `sum by (tenant_id) (increase(${TENANT_API_REQUESTS_SERIES}[1d]))`,
      START,
      NOW_SEC,
      DAY,
    );
  });

  it('should count active users from 24h ago and pass the reseller filter through', async () => {
    await service.list(CTX, args({ resellerId: RESELLER }));

    expect(repo.listInstitutes).toHaveBeenCalledWith(CTX, RESELLER);
    expect(repo.countActiveUsersSince).toHaveBeenCalledWith(CTX, new Date((NOW_SEC - DAY) * 1000));
  });

  describe('sorting', () => {
    it.each([
      ['INSTITUTE_NAME', 'ASC', [INST_B, INST_A, INST_C]],
      ['INSTITUTE_NAME', 'DESC', [INST_C, INST_A, INST_B]],
      ['ACTIVE_USERS_24H', 'ASC', [INST_B, INST_A, INST_C]],
      ['ACTIVE_USERS_24H', 'DESC', [INST_C, INST_A, INST_B]],
      ['API_CALLS_24H', 'ASC', [INST_C, INST_A, INST_B]],
      ['API_CALLS_24H', 'DESC', [INST_B, INST_A, INST_C]],
    ] as const)('should sort by %s %s', async (sortBy, sortOrder, expected) => {
      const result = await service.list(CTX, args({ sortBy, sortOrder }));

      expect(result.edges.map((e) => e.node.instituteId)).toEqual(expected);
    });

    it('should fall back to API_CALLS_24H DESC and 25 rows when the client sends nulls', async () => {
      const result = await service.list(CTX, args({ first: null, sortBy: null, sortOrder: null }));

      expect(result.edges.map((e) => e.node.instituteId)).toEqual([INST_B, INST_A, INST_C]);
    });

    it('should break ties by institute id so pages stay stable', async () => {
      vi.mocked(openObserve.query).mockRejectedValue(new OpenObserveUnavailableError('down'));

      const result = await service.list(CTX, args({ sortBy: 'API_CALLS_24H', sortOrder: 'DESC' }));

      expect(result.edges.map((e) => e.node.instituteId)).toEqual([INST_A, INST_B, INST_C]);
    });
  });

  describe('pagination', () => {
    it('should return the first page with a cursor to the next one', async () => {
      const result = await service.list(CTX, args({ first: 2 }));

      expect(result.edges.map((e) => e.node.instituteId)).toEqual([INST_B, INST_A]);
      expect(result.pageInfo).toEqual({
        hasNextPage: true,
        hasPreviousPage: false,
        startCursor: encodeOffsetCursor(1),
        endCursor: encodeOffsetCursor(2),
      });
    });

    it('should continue after the given cursor', async () => {
      const result = await service.list(CTX, args({ first: 2, after: encodeOffsetCursor(2) }));

      expect(result.edges.map((e) => e.node.instituteId)).toEqual([INST_C]);
      expect(result.pageInfo).toEqual({
        hasNextPage: false,
        hasPreviousPage: true,
        startCursor: encodeOffsetCursor(3),
        endCursor: encodeOffsetCursor(3),
      });
      expect(result.totalCount).toBe(3);
    });

    it('should return an empty page past the end', async () => {
      const result = await service.list(CTX, args({ after: encodeOffsetCursor(10) }));

      expect(result.edges).toEqual([]);
      expect(result.pageInfo).toEqual({
        hasNextPage: false,
        hasPreviousPage: true,
        startCursor: null,
        endCursor: null,
      });
    });

    it.each([
      'not-base64-json',
      Buffer.from(JSON.stringify({ o: -1 })).toString('base64url'),
      Buffer.from(JSON.stringify({ o: 1.5 })).toString('base64url'),
      Buffer.from(JSON.stringify({ x: 1 })).toString('base64url'),
    ])('should reject a malformed cursor %s', async (after) => {
      await expect(service.list(CTX, args({ after }))).rejects.toThrow(BusinessException);
    });
  });

  describe('OpenObserve unavailable', () => {
    it('should still answer with null API metrics and metricsAvailable=false', async () => {
      vi.mocked(openObserve.queryRange).mockRejectedValue(new OpenObserveUnavailableError('down'));

      const result = await service.list(CTX, args({ sortBy: 'ACTIVE_USERS_24H' }));

      expect(result.metricsAvailable).toBe(false);
      expect(result.edges.map((e) => e.node)).toEqual([
        {
          ...institutes[2],
          activeUsers24h: 9,
          storageUsedBytes: 2_000_000,
          apiCalls24h: null,
          activityTrend7d: null,
        },
        {
          ...institutes[0],
          activeUsers24h: 2,
          storageUsedBytes: 5_000,
          apiCalls24h: null,
          activityTrend7d: null,
        },
        {
          ...institutes[1],
          activeUsers24h: 0,
          storageUsedBytes: 0,
          apiCalls24h: null,
          activityTrend7d: null,
        },
      ]);
    });

    it('should rethrow errors that are not OpenObserve outages', async () => {
      vi.mocked(openObserve.query).mockRejectedValue(new TypeError('bug'));

      await expect(service.list(CTX, args())).rejects.toThrow(TypeError);
    });
  });
});

describe('zeroFillTrend', () => {
  it('should place each point on its day and zero-fill missing days', () => {
    expect(
      zeroFillTrend(
        [
          [START, 3],
          [START + 3 * DAY, 7.6],
          [START + 6 * DAY, 1],
        ],
        START,
        DAY,
      ),
    ).toEqual([3, 0, 0, 8, 0, 0, 1]);
  });

  it('should ignore points outside the 7-day window', () => {
    expect(
      zeroFillTrend(
        [
          [START - DAY, 5],
          [START + 7 * DAY, 5],
        ],
        START,
        DAY,
      ),
    ).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('offset cursor', () => {
  it('should round-trip', () => {
    expect(decodeOffsetCursor(encodeOffsetCursor(42))).toBe(42);
  });
});
