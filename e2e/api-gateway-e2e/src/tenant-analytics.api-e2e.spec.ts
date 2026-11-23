/**
 * ROV-184 — adminTenantAnalytics against the full running stack.
 *
 * Active-user counting and the reseller-scope rejection with synthetic fixtures are covered in
 * apps/api-gateway/src/admin/monitoring/tenant-analytics/__tests__/tenant-analytics.integration.spec.ts.
 * The e2e stack runs no OpenObserve, so API-call metrics are expected to be unavailable here.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { ErrorCode } from '@roviq/common-types';
import { beforeAll, describe, expect, it } from 'vitest';

import { SEED } from '../../shared/seed-fixtures';
import { E2eAdminTenantAnalyticsDocument } from './__generated__/graphql';
import { loginAsInstituteAdmin, loginAsPlatformAdmin, loginAsReseller } from './helpers/auth';
import { gql } from './helpers/gql-client';

describe('adminTenantAnalytics E2E', () => {
  let platformToken: string;

  beforeAll(async () => {
    ({ accessToken: platformToken } = await loginAsPlatformAdmin());
  });

  it('should list institutes with their reseller and active-user counts for a platform admin', async () => {
    // A fresh institute login guarantees INSTITUTE_1 has an active user in the last 24h.
    await loginAsInstituteAdmin();

    const res = await gql(
      E2eAdminTenantAnalyticsDocument,
      { first: 100, sortBy: 'INSTITUTE_NAME', sortOrder: 'ASC' },
      platformToken,
    );

    expect(res.errors).toBeUndefined();
    const conn = res.data?.adminTenantAnalytics;
    assert(conn);
    expect(conn.totalCount).toBeGreaterThanOrEqual(2);
    const inst1 = conn.edges.find((e) => e.node.instituteId === SEED.INSTITUTE_1.id)?.node;
    assert(inst1);
    expect(inst1.instituteName).toEqual({ en: SEED.INSTITUTE_1.name, hi: SEED.INSTITUTE_1.nameHi });
    expect(inst1.activeUsers24h).toBeGreaterThanOrEqual(1);
    if (conn.metricsAvailable) {
      expect(inst1.activityTrend7d).toHaveLength(7);
    } else {
      expect(inst1.apiCalls24h).toBeNull();
      expect(inst1.activityTrend7d).toBeNull();
    }
  });

  it('should only return institutes of the requested reseller', async () => {
    const res = await gql(
      E2eAdminTenantAnalyticsDocument,
      { first: 100, resellerId: SEED.RESELLER.id },
      platformToken,
    );

    expect(res.errors).toBeUndefined();
    const conn = res.data?.adminTenantAnalytics;
    assert(conn);
    expect(conn.edges.length).toBeGreaterThan(0);
    expect(new Set(conn.edges.map((e) => e.node.resellerId))).toEqual(new Set([SEED.RESELLER.id]));
    expect(new Set(conn.edges.map((e) => e.node.resellerName))).toEqual(
      new Set([SEED.RESELLER.name]),
    );
  });

  it('should return nothing for a reseller that owns no institutes', async () => {
    const res = await gql(
      E2eAdminTenantAnalyticsDocument,
      { resellerId: randomUUID() },
      platformToken,
    );

    expect(res.errors).toBeUndefined();
    expect(res.data?.adminTenantAnalytics.totalCount).toBe(0);
    expect(res.data?.adminTenantAnalytics.edges).toEqual([]);
  });

  it('should page through the list with the returned cursor', async () => {
    const first = await gql(
      E2eAdminTenantAnalyticsDocument,
      { first: 1, sortBy: 'INSTITUTE_NAME', sortOrder: 'ASC' },
      platformToken,
    );
    expect(first.errors).toBeUndefined();
    const page1 = first.data?.adminTenantAnalytics;
    assert(page1?.pageInfo.endCursor);
    expect(page1.pageInfo.hasNextPage).toBe(true);

    const second = await gql(
      E2eAdminTenantAnalyticsDocument,
      { first: 1, after: page1.pageInfo.endCursor, sortBy: 'INSTITUTE_NAME', sortOrder: 'ASC' },
      platformToken,
    );

    expect(second.errors).toBeUndefined();
    const page2 = second.data?.adminTenantAnalytics;
    assert(page2);
    expect(page2.pageInfo.hasPreviousPage).toBe(true);
    expect(page2.edges[0]?.node.instituteId).not.toBe(page1.edges[0]?.node.instituteId);
  });

  it('should reject an institute-scope caller', async () => {
    const { accessToken } = await loginAsInstituteAdmin();

    const res = await gql(E2eAdminTenantAnalyticsDocument, {}, accessToken);

    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('should reject a reseller-scope caller', async () => {
    const { accessToken } = await loginAsReseller();

    const res = await gql(E2eAdminTenantAnalyticsDocument, {}, accessToken);

    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('should reject an unauthenticated caller', async () => {
    const res = await gql(E2eAdminTenantAnalyticsDocument, {});

    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it('should reject a malformed cursor', async () => {
    const res = await gql(E2eAdminTenantAnalyticsDocument, { after: 'garbage' }, platformToken);

    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});
