import { Injectable, Logger } from '@nestjs/common';
import { BusinessException, ErrorCode, type PlatformContext } from '@roviq/common-types';
import { PrometheusClient, PrometheusUnavailableError } from '../prometheus.client';
import {
  type AdminTenantAnalyticsArgs,
  SortOrder,
  TenantAnalyticsSortField,
} from './dto/tenant-analytics.args';
import type {
  TenantAnalyticsConnection,
  TenantAnalyticsModel,
} from './models/tenant-analytics.model';
import {
  TenantAnalyticsRepository,
  type TenantInstituteRecord,
} from './repositories/tenant-analytics.repository';

/** Prometheus series of the `roviq.api.requests` OTel counter (collector adds the `roviq_` namespace and `_total`). */
export const TENANT_API_REQUESTS_SERIES = 'roviq_roviq_api_requests_total';

const DAY_SEC = 86_400;
const TREND_DAYS = 7;
const DEFAULT_PAGE_SIZE = 25;

interface TenantApiMetrics {
  calls24h: Map<string, number>;
  trend7d: Map<string, number[]>;
}

@Injectable()
export class TenantAnalyticsService {
  private readonly logger = new Logger(TenantAnalyticsService.name);

  constructor(
    private readonly repo: TenantAnalyticsRepository,
    private readonly prometheus: PrometheusClient,
  ) {}

  // Sorting can depend on Prometheus values, so the whole institute list is built in memory
  // and sliced; fine for the expected low thousands of institutes.
  async list(
    ctx: PlatformContext,
    args: AdminTenantAnalyticsArgs,
  ): Promise<TenantAnalyticsConnection> {
    const offset = args.after ? decodeOffsetCursor(args.after) : 0;
    // An explicit null from the client bypasses the GraphQL default, so the defaults live here too.
    const first = args.first ?? DEFAULT_PAGE_SIZE;
    const sortBy = args.sortBy ?? TenantAnalyticsSortField.API_CALLS_24H;
    const sortOrder = args.sortOrder ?? SortOrder.DESC;
    const nowSec = Math.floor(Date.now() / 1000);

    const [institutes, activeUsers, apiMetrics] = await Promise.all([
      this.repo.listInstitutes(ctx, args.resellerId ?? null),
      this.repo.countActiveUsersSince(ctx, new Date((nowSec - DAY_SEC) * 1000)),
      this.fetchApiMetrics(nowSec),
    ]);

    const activeByTenant = new Map(activeUsers.map((r) => [r.tenantId, r.activeUsers]));
    const rows = institutes.map((inst) => toModel(inst, activeByTenant, apiMetrics));
    rows.sort(comparator(sortBy, sortOrder));

    const page = rows.slice(offset, offset + first);
    const edges = page.map((node, i) => ({ cursor: encodeOffsetCursor(offset + i + 1), node }));
    return {
      edges,
      totalCount: rows.length,
      metricsAvailable: apiMetrics !== null,
      pageInfo: {
        hasNextPage: offset + page.length < rows.length,
        hasPreviousPage: offset > 0,
        startCursor: edges[0]?.cursor ?? null,
        endCursor: edges.at(-1)?.cursor ?? null,
      },
    };
  }

  private async fetchApiMetrics(nowSec: number): Promise<TenantApiMetrics | null> {
    const startSec = nowSec - (TREND_DAYS - 1) * DAY_SEC;
    try {
      const [calls, trend] = await Promise.all([
        this.prometheus.query(`sum by (tenant_id) (increase(${TENANT_API_REQUESTS_SERIES}[24h]))`),
        this.prometheus.queryRange(
          `sum by (tenant_id) (increase(${TENANT_API_REQUESTS_SERIES}[1d]))`,
          startSec,
          nowSec,
          DAY_SEC,
        ),
      ]);
      return {
        calls24h: new Map(calls.map((s) => [s.metric.tenant_id, Math.round(s.value)])),
        trend7d: new Map(
          trend.map((s) => [s.metric.tenant_id, zeroFillTrend(s.values, startSec, DAY_SEC)]),
        ),
      };
    } catch (err) {
      if (!(err instanceof PrometheusUnavailableError)) throw err;
      this.logger.warn(`Tenant API metrics omitted: ${err.message}`);
      return null;
    }
  }
}

/** One value per day from `startSec`, oldest first; days Prometheus returned nothing for are 0. */
export function zeroFillTrend(
  values: Array<[number, number]>,
  startSec: number,
  stepSec: number,
): number[] {
  const out = new Array<number>(TREND_DAYS).fill(0);
  for (const [ts, value] of values) {
    const idx = Math.round((ts - startSec) / stepSec);
    if (idx >= 0 && idx < TREND_DAYS) out[idx] = Math.round(value);
  }
  return out;
}

function toModel(
  inst: TenantInstituteRecord,
  activeByTenant: Map<string, number>,
  apiMetrics: TenantApiMetrics | null,
): TenantAnalyticsModel {
  return {
    ...inst,
    activeUsers24h: activeByTenant.get(inst.instituteId) ?? 0,
    apiCalls24h: apiMetrics ? (apiMetrics.calls24h.get(inst.instituteId) ?? 0) : null,
    activityTrend7d: apiMetrics
      ? (apiMetrics.trend7d.get(inst.instituteId) ?? new Array<number>(TREND_DAYS).fill(0))
      : null,
  };
}

function displayName(name: Record<string, string>): string {
  return name.en ?? Object.values(name)[0] ?? '';
}

function comparator(
  sortBy: TenantAnalyticsSortField,
  sortOrder: SortOrder,
): (a: TenantAnalyticsModel, b: TenantAnalyticsModel) => number {
  const dir = sortOrder === 'ASC' ? 1 : -1;
  const primary = (a: TenantAnalyticsModel, b: TenantAnalyticsModel): number => {
    switch (sortBy) {
      case 'INSTITUTE_NAME':
        return displayName(a.instituteName).localeCompare(displayName(b.instituteName), 'en', {
          sensitivity: 'base',
        });
      case 'ACTIVE_USERS_24H':
        return a.activeUsers24h - b.activeUsers24h;
      case 'API_CALLS_24H':
        return (a.apiCalls24h ?? 0) - (b.apiCalls24h ?? 0);
    }
  };
  // Id tie-break keeps page boundaries stable between requests.
  return (a, b) => primary(a, b) * dir || a.instituteId.localeCompare(b.instituteId);
}

export function encodeOffsetCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
}

export function decodeOffsetCursor(cursor: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
  } catch {
    throw new BusinessException(ErrorCode.VALIDATION_FAILED, 'Invalid cursor');
  }
  const offset =
    typeof parsed === 'object' && parsed !== null && 'o' in parsed ? parsed.o : undefined;
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
    throw new BusinessException(ErrorCode.VALIDATION_FAILED, 'Invalid cursor');
  }
  return offset;
}
