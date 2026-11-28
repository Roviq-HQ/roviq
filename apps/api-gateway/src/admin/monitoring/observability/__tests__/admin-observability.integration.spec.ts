/**
 * The observability reads (ROV-401) through guards, resolver and service. The telemetry store
 * is replaced by a spy on its client: what is proved here is who may ask, and that nothing is
 * asked of the store for a caller who may not.
 */
import { randomUUID } from 'node:crypto';
import { ErrorCode } from '@roviq/common-types';
import {
  cleanupTestInstitute,
  cleanupTestReseller,
  createInstituteToken,
  createIntegrationApp,
  createPlatformToken,
  createResellerToken,
  createTestInstitute,
  createTestReseller,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
  type TestReseller,
} from '@roviq/testing/integration';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SEED_IDS } from '../../../../../../../e2e/shared/seed-fixtures';
import { AppModule } from '../../../../app/app.module';
import { OpenObserveClient } from '../../openobserve.client';

const QUERIES: Readonly<Record<string, string>> = {
  adminObservabilityLogs: 'query { adminObservabilityLogs(services: ["api-gateway"], limit: 5) }',
  adminObservabilityTraces: 'query { adminObservabilityTraces(limit: 5) }',
  adminObservabilityMetrics: 'query { adminObservabilityMetrics(query: "up", endpoint: "query") }',
  adminObservabilityAlerts: 'query { adminObservabilityAlerts }',
};
const FIELDS = Object.keys(QUERIES);

describe('observability reads (integration)', () => {
  let result: IntegrationAppResult;
  let institute: TestInstitute;
  let reseller: TestReseller;
  let store: OpenObserveClient;

  const platformToken = createPlatformToken({
    sub: SEED_IDS.USER_ADMIN,
    membershipId: randomUUID(),
    roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
  });

  const ask = (field: string, token: string) =>
    gqlRequest<Record<string, unknown>>(result.httpServer, { query: QUERIES[field], token });

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    institute = await createTestInstitute(result.db);
    reseller = await createTestReseller(result.db);
    store = result.app.get(OpenObserveClient, { strict: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (institute) await cleanupTestInstitute(result.db, institute);
    if (reseller) await cleanupTestReseller(result.db, reseller);
    await result?.close();
  });

  function spyOnStore() {
    return {
      search: vi.spyOn(store, 'search').mockResolvedValue({ hits: [{ body: 'a log line' }] }),
      prometheus: vi
        .spyOn(store, 'prometheus')
        .mockResolvedValue({ status: 'success', data: { resultType: 'vector', result: [] } }),
      alerts: vi.spyOn(store, 'alerts').mockResolvedValue([]),
    };
  }

  it('should answer a platform admin with what the store returned', async () => {
    const spies = spyOnStore();

    const logs = await ask('adminObservabilityLogs', platformToken);
    const metrics = await ask('adminObservabilityMetrics', platformToken);
    const alerts = await ask('adminObservabilityAlerts', platformToken);

    expect(logs.errors).toBeUndefined();
    expect(logs.data?.adminObservabilityLogs).toEqual({ hits: [{ body: 'a log line' }] });
    expect(spies.search).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'logs', size: 5, sinceSeconds: 3600 }),
    );
    expect(metrics.data?.adminObservabilityMetrics).toMatchObject({ status: 'success' });
    expect(alerts.data?.adminObservabilityAlerts).toEqual({
      status: 'success',
      data: { alerts: [] },
    });
  });

  it('should refuse a service name that is not a plain name, before the store is asked', async () => {
    const spies = spyOnStore();

    const { errors } = await gqlRequest(result.httpServer, {
      query: `query { adminObservabilityLogs(services: ["web' OR '1'='1"]) }`,
      token: platformToken,
    });

    expect(errors?.[0]?.extensions?.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(spies.search).not.toHaveBeenCalled();
  });

  it.each(
    FIELDS,
  )('should refuse an institute token on %s and ask the store nothing', async (field) => {
    const spies = spyOnStore();
    const token = createInstituteToken({
      sub: institute.userId,
      tenantId: institute.tenantId,
      membershipId: institute.membershipId,
      roleId: institute.roleId,
    });

    const { errors, data } = await ask(field, token);

    expect(errors?.[0]?.extensions?.code).toBe(ErrorCode.FORBIDDEN);
    expect(data ?? null).toBeNull();
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  });

  it.each(
    FIELDS,
  )('should refuse a reseller token on %s and ask the store nothing', async (field) => {
    const spies = spyOnStore();
    const token = createResellerToken({
      sub: reseller.userId,
      resellerId: reseller.resellerId,
      membershipId: reseller.membershipId,
      roleId: reseller.roleId,
    });

    const { errors, data } = await ask(field, token);

    expect(errors?.[0]?.extensions?.code).toBe(ErrorCode.FORBIDDEN);
    expect(data ?? null).toBeNull();
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  });

  it.each(FIELDS)('should refuse a request with no token on %s', async (field) => {
    const spies = spyOnStore();

    const { errors } = await gqlRequest(result.httpServer, { query: QUERIES[field] });

    expect(errors?.[0]?.extensions?.code).toBe(ErrorCode.UNAUTHENTICATED);
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  });
});
