/**
 * adminTenantAnalytics (ROV-184) through the real resolver → service → withAdmin pipeline.
 * Prometheus is stubbed so the test never reaches another instance's observability stack.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { ErrorCode } from '@roviq/common-types';
import {
  mkAdminCtx,
  refreshTokens,
  resellersLive,
  SYSTEM_USER_ID,
  withAdmin,
} from '@roviq/database';
import {
  cleanupTestInstitute,
  cleanupTestReseller,
  cleanupTestTeacher,
  createInstituteToken,
  createIntegrationApp,
  createMock,
  createPlatformToken,
  createResellerToken,
  createTestInstitute,
  createTestReseller,
  createTestTeacher,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
  type TestReseller,
  type TestTeacher,
} from '@roviq/testing/integration';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SEED_IDS } from '../../../../../../../e2e/shared/seed-fixtures';
import { AppModule } from '../../../../app/app.module';
import { PrometheusClient } from '../../prometheus.client';
import { TenantAnalyticsRepository } from '../repositories/tenant-analytics.repository';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const QUERY = `
  query($resellerId: ID, $sortBy: TenantAnalyticsSortField) {
    adminTenantAnalytics(first: 100, resellerId: $resellerId, sortBy: $sortBy, sortOrder: DESC) {
      totalCount
      metricsAvailable
      edges { node { instituteId instituteName resellerId resellerName activeUsers24h apiCalls24h activityTrend7d } }
    }
  }
`;

interface AnalyticsNode {
  instituteId: string;
  instituteName: Record<string, string>;
  resellerId: string;
  resellerName: string;
  activeUsers24h: number;
  apiCalls24h: number | null;
  activityTrend7d: number[] | null;
}
interface AnalyticsData {
  adminTenantAnalytics: {
    totalCount: number;
    metricsAvailable: boolean;
    edges: Array<{ node: AnalyticsNode }>;
  };
}

describe('adminTenantAnalytics (integration)', () => {
  let result: IntegrationAppResult;
  let reseller: TestReseller;
  let instA: TestInstitute;
  let instB: TestInstitute;
  let teacherA: TestTeacher;
  const tokenIds: string[] = [];

  const prometheus = createMock<PrometheusClient>({
    query: vi.fn().mockResolvedValue([]),
    queryRange: vi.fn().mockResolvedValue([]),
  });
  let resellerName: string;

  const platformToken = createPlatformToken({
    sub: SEED_IDS.USER_ADMIN,
    membershipId: randomUUID(),
    roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
  });

  const gql = (variables?: Record<string, unknown>, token = platformToken) =>
    gqlRequest<AnalyticsData>(result.httpServer, { query: QUERY, variables, token });

  async function insertToken(
    tenantId: string,
    member: { userId: string; membershipId: string },
    createdAt: Date,
    lastUsedAt: Date | null,
  ): Promise<void> {
    const id = randomUUID();
    tokenIds.push(id);
    await withAdmin(result.db, mkAdminCtx('test:tenant-analytics'), (tx) =>
      tx.insert(refreshTokens).values({
        id,
        tenantId,
        userId: member.userId,
        membershipId: member.membershipId,
        membershipScope: 'institute',
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 7 * DAY_MS),
        createdAt,
        lastUsedAt,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      }),
    );
  }

  beforeAll(async () => {
    result = await createIntegrationApp({
      modules: [AppModule],
      overrides: [{ provide: PrometheusClient, useValue: prometheus }],
    });
    reseller = await createTestReseller(result.db);
    instA = await createTestInstitute(result.db, { resellerId: reseller.resellerId });
    instB = await createTestInstitute(result.db, { resellerId: reseller.resellerId });
    const [row] = await withAdmin(result.db, mkAdminCtx('test:tenant-analytics'), (tx) =>
      tx
        .select({ name: resellersLive.name })
        .from(resellersLive)
        .where(eq(resellersLive.id, reseller.resellerId)),
    );
    assert(row);
    resellerName = row.name;

    const now = Date.now();
    // A: same user twice (counts once) + a stale token of another user (not counted).
    teacherA = await createTestTeacher(result.db, instA.tenantId);
    await insertToken(instA.tenantId, instA, new Date(now - HOUR_MS), null);
    await insertToken(instA.tenantId, instA, new Date(now - 2 * HOUR_MS), null);
    await insertToken(
      instA.tenantId,
      teacherA,
      new Date(now - 3 * DAY_MS),
      new Date(now - 2 * DAY_MS),
    );
    // B: old token kept alive by a recent use.
    await insertToken(instB.tenantId, instB, new Date(now - 3 * DAY_MS), new Date(now - HOUR_MS));
  });

  afterAll(async () => {
    await withAdmin(result.db, mkAdminCtx('test:tenant-analytics'), (tx) =>
      tx.delete(refreshTokens).where(inArray(refreshTokens.id, tokenIds)),
    );
    await cleanupTestTeacher(result.db, teacherA);
    await cleanupTestInstitute(result.db, instA);
    await cleanupTestInstitute(result.db, instB);
    await cleanupTestReseller(result.db, reseller);
    await result.app.close();
  });

  it('should count distinct users with a token created or used in the last 24h', async () => {
    const repo = result.app.get(TenantAnalyticsRepository);

    const rows = await repo.countActiveUsersSince(
      mkAdminCtx('test:tenant-analytics'),
      new Date(Date.now() - DAY_MS),
    );

    const byTenant = new Map(rows.map((r) => [r.tenantId, r.activeUsers]));
    expect(byTenant.get(instA.tenantId)).toBe(1);
    expect(byTenant.get(instB.tenantId)).toBe(1);
  });

  it('should return only the filtered reseller institutes with DB and Prometheus data', async () => {
    vi.mocked(prometheus.query).mockResolvedValueOnce([
      { metric: { tenant_id: instB.tenantId }, value: 17 },
    ]);

    const { data, errors } = await gql({
      resellerId: reseller.resellerId,
      sortBy: 'API_CALLS_24H',
    });

    expect(errors).toBeUndefined();
    const conn = data?.adminTenantAnalytics;
    expect(conn?.metricsAvailable).toBe(true);
    expect(conn?.totalCount).toBe(2);
    expect(conn?.edges.map((e) => e.node)).toEqual([
      {
        instituteId: instB.tenantId,
        instituteName: { en: `Test Institute ${instB.slug.replace('test-', '')}` },
        resellerId: reseller.resellerId,
        resellerName,
        activeUsers24h: 1,
        apiCalls24h: 17,
        activityTrend7d: [0, 0, 0, 0, 0, 0, 0],
      },
      {
        instituteId: instA.tenantId,
        instituteName: { en: `Test Institute ${instA.slug.replace('test-', '')}` },
        resellerId: reseller.resellerId,
        resellerName,
        activeUsers24h: 1,
        apiCalls24h: 0,
        activityTrend7d: [0, 0, 0, 0, 0, 0, 0],
      },
    ]);
  });

  it('should reject an institute-scope token', async () => {
    const token = createInstituteToken({
      sub: instA.userId,
      tenantId: instA.tenantId,
      membershipId: instA.membershipId,
      roleId: instA.roleId,
    });

    const { errors } = await gql({}, token);

    expect(errors?.[0]?.extensions?.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('should reject a reseller-scope token', async () => {
    const token = createResellerToken({
      sub: reseller.userId,
      resellerId: reseller.resellerId,
      membershipId: reseller.membershipId,
      roleId: reseller.roleId,
    });

    const { errors } = await gql({}, token);

    expect(errors?.[0]?.extensions?.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('should reject an invalid reseller id', async () => {
    const { errors } = await gql({ resellerId: 'not-a-uuid' });

    expect(errors?.[0]?.extensions?.code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});
