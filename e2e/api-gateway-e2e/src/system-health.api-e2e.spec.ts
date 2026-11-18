/**
 * ROV-184 — platform system health against the full running stack.
 *
 * The e2e stack has no MinIO and no Prometheus, so MINIO is expected DOWN and
 * alerts unavailable; every other dependency is a live container and must be up.
 * Status/degraded/uptime math and change detection are unit-tested in
 * apps/api-gateway/src/admin/monitoring/system-health/__tests__.
 */
import assert from 'node:assert';
import { MONITORED_SERVICE_VALUES, ServiceHealthStatus } from '@roviq/common-types';
import { beforeAll, describe, expect, it } from 'vitest';

import { loginAsInstituteAdmin, loginAsPlatformAdmin, loginAsReseller } from './helpers/auth';
import { gql } from './helpers/gql-client';
import { subscribeOnce } from './helpers/ws-client';

interface ServiceHealthNode {
  name: string;
  status: string;
  responseMs: number | null;
  uptimePercent: number | null;
  checkedAt: string;
}

interface SystemHealthNode {
  services: ServiceHealthNode[];
  natsStreams: { name: string; consumerLag: number }[];
  connections: { websocket: number; http: number };
  alerts: { name: string; severity: string; message: string; since: string }[];
  alertsAvailable: boolean;
  dlqPendingCount: number;
  checkedAt: string;
}

const SYSTEM_HEALTH_FIELDS = `
  services { name status responseMs uptimePercent checkedAt }
  natsStreams { name consumerLag }
  connections { websocket http }
  alerts { name severity message since }
  alertsAvailable
  dlqPendingCount
  checkedAt
`;

const SYSTEM_HEALTH_QUERY = `query { adminSystemHealth { ${SYSTEM_HEALTH_FIELDS} } }`;
const CONNECTION_METRICS_QUERY = `query { adminConnectionMetrics { websocket http } }`;
const LIVE_DEPENDENCIES = ['API_GATEWAY', 'POSTGRES', 'REDIS', 'NATS', 'TEMPORAL'];

describe('System health E2E (ROV-184)', () => {
  let platformToken: string;

  beforeAll(async () => {
    ({ accessToken: platformToken } = await loginAsPlatformAdmin());
  });

  describe('adminSystemHealth', () => {
    it('returns all six services in enum order with the live dependencies up', async () => {
      const res = await gql<{ adminSystemHealth: SystemHealthNode }>(
        SYSTEM_HEALTH_QUERY,
        undefined,
        platformToken,
      );

      expect(res.errors).toBeUndefined();
      const health = res.data?.adminSystemHealth;
      assert(health);
      expect(health.services.map((s) => s.name)).toEqual([...MONITORED_SERVICE_VALUES]);
      for (const service of health.services.filter((s) => LIVE_DEPENDENCIES.includes(s.name))) {
        expect(service.status, service.name).not.toBe(ServiceHealthStatus.DOWN);
        expect(service.responseMs, service.name).toBeGreaterThanOrEqual(0);
        expect(service.uptimePercent, service.name).toBeGreaterThan(0);
      }
    });

    it('reports JetStream streams, connections and the DLQ backlog', async () => {
      const res = await gql<{ adminSystemHealth: SystemHealthNode }>(
        SYSTEM_HEALTH_QUERY,
        undefined,
        platformToken,
      );

      expect(res.errors).toBeUndefined();
      const health = res.data?.adminSystemHealth;
      assert(health);
      expect(health.natsStreams.map((s) => s.name)).toContain('DLQ');
      expect(health.connections.http).toBeGreaterThanOrEqual(1);
      expect(health.dlqPendingCount).toBeGreaterThanOrEqual(0);
      expect(Number.isNaN(Date.parse(health.checkedAt))).toBe(false);
    });

    it('rejects an unauthenticated request', async () => {
      const res = await gql(SYSTEM_HEALTH_QUERY);

      expect(res.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
    });

    it('rejects an institute-scope token', async () => {
      const { accessToken } = await loginAsInstituteAdmin();

      const res = await gql(SYSTEM_HEALTH_QUERY, undefined, accessToken);

      expect(res.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
      expect(res.data).toBeNull();
    });

    it('rejects a reseller-scope token', async () => {
      const { accessToken } = await loginAsReseller();

      const res = await gql(SYSTEM_HEALTH_QUERY, undefined, accessToken);

      expect(res.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
      expect(res.data).toBeNull();
    });
  });

  describe('adminConnectionMetrics', () => {
    it('counts at least the in-flight request asking for it', async () => {
      const res = await gql<{ adminConnectionMetrics: { websocket: number; http: number } }>(
        CONNECTION_METRICS_QUERY,
        undefined,
        platformToken,
      );

      expect(res.errors).toBeUndefined();
      expect(res.data?.adminConnectionMetrics.http).toBeGreaterThanOrEqual(1);
      expect(res.data?.adminConnectionMetrics.websocket).toBeGreaterThanOrEqual(0);
    });

    it('rejects a reseller-scope token', async () => {
      const { accessToken } = await loginAsReseller();

      const res = await gql(CONNECTION_METRICS_QUERY, undefined, accessToken);

      expect(res.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    });
  });

  describe('adminSystemHealthUpdated', () => {
    it('delivers the current snapshot on subscribe', async () => {
      const event = await subscribeOnce<{ adminSystemHealthUpdated: SystemHealthNode }>(
        `subscription { adminSystemHealthUpdated { ${SYSTEM_HEALTH_FIELDS} } }`,
        {},
        platformToken,
      );

      expect(event.adminSystemHealthUpdated.services.map((s) => s.name)).toEqual([
        ...MONITORED_SERVICE_VALUES,
      ]);
      // The subscriber's own socket is counted.
      expect(event.adminSystemHealthUpdated.connections.websocket).toBeGreaterThanOrEqual(1);
    });

    it('rejects an institute-scope subscriber', async () => {
      const { accessToken } = await loginAsInstituteAdmin();

      await expect(
        subscribeOnce(
          `subscription { adminSystemHealthUpdated { checkedAt } }`,
          {},
          accessToken,
          2_500,
        ),
      ).rejects.toThrow(/FORBIDDEN|platform scope required/);
    });
  });
});
