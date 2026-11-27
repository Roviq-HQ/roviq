/**
 * ROV-293: auditLogs and resellerAuditLogs filters that name another institute, another
 * reseller or another institute's impersonation session return none of their rows.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { auditLogs, impersonationSessions, mkAdminCtx, withAdmin } from '@roviq/database';
import {
  createInstituteToken,
  createIntegrationApp,
  createResellerToken,
  createTestInstitute,
  createTestReseller,
  type IntegrationAppResult,
  RESELLER_DIRECT_ID,
  type TestInstitute,
  type TestReseller,
} from '@roviq/testing/integration';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { foreignIdRequests } from '../../__tests__/foreign-id-requests';
import { AppModule } from '../../app/app.module';

const ORIGIN = 'test:audit-foreign-id';

const AUDIT_LOGS = /* GraphQL */ `
  query AuditLogs($filter: AuditLogFilterInput) {
    auditLogs(filter: $filter, first: 100) {
      totalCount
      edges {
        node {
          id
          tenantId
        }
      }
    }
  }
`;

const RESELLER_AUDIT_LOGS = /* GraphQL */ `
  query ResellerAuditLogs($filter: AuditLogFilterInput) {
    resellerAuditLogs(filter: $filter, first: 100) {
      totalCount
      edges {
        node {
          id
          tenantId
        }
      }
    }
  }
`;

interface Connection {
  totalCount: number;
  edges: { node: { id: string; tenantId: string | null } }[];
}

describe('audit log filters: another institute or reseller id (ROV-293)', () => {
  let result: IntegrationAppResult;
  let resellerOwn: TestReseller;
  let resellerOther: TestReseller;
  let instA: TestInstitute;
  let instB: TestInstitute;
  let instDirect: TestInstitute;
  let sessionB: string;
  let sessionDirect: string;

  const request = foreignIdRequests({
    httpServer: () => result.httpServer,
    foreignIds: () => [resellerOther, instB, instDirect, sessionB, sessionDirect],
    specFile: __filename,
  });
  const ownRowId = randomUUID();
  const foreignRowIds = { b: randomUUID(), direct: randomUUID(), reseller: randomUUID() };

  const instituteToken = () =>
    createInstituteToken({
      sub: instA.userId,
      tenantId: instA.tenantId,
      membershipId: instA.membershipId,
      roleId: instA.roleId,
    });
  const resellerToken = () =>
    createResellerToken({
      sub: resellerOwn.userId,
      resellerId: resellerOwn.resellerId,
      membershipId: resellerOwn.membershipId,
      roleId: resellerOwn.roleId,
    });

  const row = (inst: TestInstitute, id: string, impersonationSessionId: string | null) => ({
    id,
    scope: 'institute',
    tenantId: inst.tenantId,
    userId: inst.userId,
    actorId: inst.userId,
    impersonationSessionId,
    action: 'updateStudent',
    actionType: 'UPDATE',
    entityType: 'Student',
    entityId: randomUUID(),
    correlationId: randomUUID(),
    source: 'GATEWAY',
  });

  const session = (inst: TestInstitute) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), async (tx) => {
      const [created] = await tx
        .insert(impersonationSessions)
        .values({
          impersonatorId: inst.userId,
          impersonatorScope: 'institute',
          targetUserId: inst.userId,
          targetTenantId: inst.tenantId,
          reason: 'Support ticket for the foreign-id test',
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        })
        .returning({ id: impersonationSessions.id });
      return created.id;
    });

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    resellerOwn = await createTestReseller(result.db);
    resellerOther = await createTestReseller(result.db);
    instA = await createTestInstitute(result.db, { resellerId: resellerOwn.resellerId });
    instB = await createTestInstitute(result.db, { resellerId: resellerOther.resellerId });
    instDirect = await createTestInstitute(result.db);
    sessionB = await session(instB);
    sessionDirect = await session(instDirect);
    await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
      tx.insert(auditLogs).values([
        row(instA, ownRowId, null),
        row(instB, foreignRowIds.b, sessionB),
        row(instDirect, foreignRowIds.direct, sessionDirect),
        {
          id: foreignRowIds.reseller,
          scope: 'reseller',
          tenantId: null,
          resellerId: resellerOther.resellerId,
          userId: resellerOther.userId,
          actorId: resellerOther.userId,
          action: 'resellerSuspendInstitute',
          actionType: 'SUSPEND',
          entityType: 'Institute',
          entityId: instB.tenantId,
          correlationId: randomUUID(),
          source: 'GATEWAY',
        },
      ]),
    );
    const stored = await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(inArray(auditLogs.id, Object.values(foreignRowIds))),
    );
    assert.equal(stored.length, 3);
  });

  afterAll(async () => {
    await result?.close();
  });

  const ids = (connection: Connection) => connection.edges.map((edge) => edge.node.id);

  describe('auditLogs (institute scope)', () => {
    const list = async (filter: Record<string, string>) => {
      const res = await request<{ auditLogs: Connection }>({
        query: AUDIT_LOGS,
        variables: { filter },
        token: instituteToken(),
      });
      expect(res.errors).toBeUndefined();
      assert(res.data);
      return res.data.auditLogs;
    };

    it('should return only its own rows for filter.tenantId of another institute', async () => {
      const connection = await list({ tenantId: instB.tenantId });
      expect(ids(connection)).toEqual([ownRowId]);
      expect(connection.totalCount).toBe(1);
    });

    it('should return no rows for filter.resellerId of another reseller', async () => {
      const connection = await list({ resellerId: resellerOther.resellerId });
      expect(ids(connection)).toEqual([]);
      expect(connection.totalCount).toBe(0);
    });

    it('should return no rows for filter.impersonationSessionId of another institute', async () => {
      const connection = await list({ impersonationSessionId: sessionB });
      expect(ids(connection)).toEqual([]);
      expect(connection.totalCount).toBe(0);
    });
  });

  describe('resellerAuditLogs (reseller scope)', () => {
    const list = async (filter: Record<string, string>) => {
      const res = await request<{ resellerAuditLogs: Connection }>({
        query: RESELLER_AUDIT_LOGS,
        variables: { filter },
        token: resellerToken(),
      });
      expect(res.errors).toBeUndefined();
      assert(res.data);
      return res.data.resellerAuditLogs;
    };

    it('should return only its own institutes rows for filter.tenantId of another reseller institute', async () => {
      const connection = await list({ tenantId: instB.tenantId });
      expect(ids(connection)).toEqual([ownRowId]);
      expect(connection.totalCount).toBe(1);
    });

    it('should return only its own institutes rows for filter.tenantId of a platform-owned institute', async () => {
      const connection = await list({ tenantId: instDirect.tenantId });
      expect(ids(connection)).toEqual([ownRowId]);
      expect(connection.totalCount).toBe(1);
    });

    it('should return no rows for filter.resellerId of another reseller', async () => {
      const connection = await list({ resellerId: resellerOther.resellerId });
      expect(ids(connection)).toEqual([]);
      expect(connection.totalCount).toBe(0);
    });

    it('should return no rows for filter.resellerId of the platform direct reseller', async () => {
      const connection = await list({ resellerId: RESELLER_DIRECT_ID });
      expect(ids(connection)).toEqual([]);
      expect(connection.totalCount).toBe(0);
    });

    it('should return no rows for filter.impersonationSessionId of another reseller institute', async () => {
      const connection = await list({ impersonationSessionId: sessionB });
      expect(ids(connection)).toEqual([]);
      expect(connection.totalCount).toBe(0);
    });

    it('should return no rows for filter.impersonationSessionId of a platform-owned institute', async () => {
      const connection = await list({ impersonationSessionId: sessionDirect });
      expect(ids(connection)).toEqual([]);
      expect(connection.totalCount).toBe(0);
    });
  });
});
