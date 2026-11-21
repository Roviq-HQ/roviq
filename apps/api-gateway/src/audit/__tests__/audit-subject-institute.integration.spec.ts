/**
 * ROV-311 — a platform or reseller action on an institute is readable in that institute's own
 * audit log, and in no other institute's. The rule is the `audit_app_read` RLS policy on
 * `subject_tenant_id`; the query adds nothing an institute could not read directly.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  auditLogs,
  institutes,
  mkAdminCtx,
  mkInstituteCtx,
  withAdmin,
  withTenant,
} from '@roviq/database';
import type { JetStreamClient } from '@roviq/nats-jetstream';
import {
  cleanupTestInstitute,
  cleanupTestReseller,
  createInstituteToken,
  createIntegrationApp,
  createMock,
  createPlatformToken,
  createTestInstitute,
  createTestReseller,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { eq, inArray } from 'drizzle-orm';
import { of } from 'rxjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SEED_IDS } from '../../../../../e2e/shared/seed-fixtures';
import { AppModule } from '../../app/app.module';

const ORIGIN = 'test:audit-subject-institute';

const AUDIT_LOGS = /* GraphQL */ `
  query {
    auditLogs(first: 100) {
      edges {
        node {
          id
          scope
          tenantId
          action
          metadata
          impersonatorId
          actorName
          ipAddress
          userAgent
        }
      }
    }
  }
`;

interface Row {
  id: string;
  scope: string;
  tenantId: string | null;
  action: string;
  metadata: Record<string, unknown> | null;
  impersonatorId: string | null;
  actorName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

describe('platform actions in an institute audit log (integration)', () => {
  let app: IntegrationAppResult;
  let instA: TestInstitute;
  let instB: TestInstitute;
  const published: { pattern: string; payload: Record<string, unknown> }[] = [];
  const platformRowId = randomUUID();
  const ownRowId = randomUUID();

  const tokenFor = (inst: TestInstitute) =>
    createInstituteToken({
      sub: inst.userId,
      tenantId: inst.tenantId,
      membershipId: inst.membershipId,
      roleId: inst.roleId,
    });

  const base = {
    userId: SEED_IDS.USER_ADMIN,
    actorId: SEED_IDS.USER_ADMIN,
    actionType: 'SUSPEND',
    entityType: 'Institute',
    correlationId: randomUUID(),
    ipAddress: '203.0.113.7',
    userAgent: 'platform-staff-browser',
    source: 'GATEWAY',
  };

  const listFor = async (inst: TestInstitute): Promise<Row[]> => {
    const res = await gqlRequest<{ auditLogs: { edges: { node: Row }[] } }>(app.httpServer, {
      query: AUDIT_LOGS,
      token: tokenFor(inst),
    });
    expect(res.errors).toBeUndefined();
    assert(res.data);
    return res.data.auditLogs.edges.map((edge) => edge.node);
  };

  beforeAll(async () => {
    assert.equal(new URL(process.env.DATABASE_URL_TEST ?? '').pathname, '/roviq_test');
    const nats = createMock<JetStreamClient>({
      emit: vi.fn((pattern: string, payload: Record<string, unknown>) => {
        published.push({ pattern, payload });
        return of(undefined);
      }),
    });
    app = await createIntegrationApp({
      modules: [AppModule],
      overrides: [{ provide: 'JETSTREAM_CLIENT', useValue: nats }],
    });
    instA = await createTestInstitute(app.db);
    instB = await createTestInstitute(app.db);
    await withAdmin(app.db, mkAdminCtx(ORIGIN), (tx) =>
      tx.insert(auditLogs).values([
        {
          ...base,
          id: platformRowId,
          scope: 'platform',
          tenantId: null,
          subjectTenantId: instA.tenantId,
          action: 'adminSuspendInstitute',
          entityId: instA.tenantId,
          impersonatorId: SEED_IDS.USER_ADMIN,
          metadata: {
            input: { id: instA.tenantId, reason: 'Fees unpaid', internalNote: 'ticket 4412' },
            error: { code: 'Error', message: 'stack trace of an internal service' },
          },
        },
        {
          ...base,
          id: ownRowId,
          scope: 'institute',
          tenantId: instA.tenantId,
          userId: instA.userId,
          actorId: instA.userId,
          action: 'updateInstituteInfo',
          actionType: 'UPDATE',
          entityId: instA.tenantId,
        },
      ]),
    );
  });

  afterAll(async () => {
    if (!app) return;
    await withAdmin(app.db, mkAdminCtx(ORIGIN), (tx) =>
      tx.delete(auditLogs).where(inArray(auditLogs.id, [platformRowId, ownRowId])),
    );
    await cleanupTestInstitute(app.db, instA);
    await cleanupTestInstitute(app.db, instB);
    await app.close();
  });

  it('shows the institute the platform action about it, next to its own rows', async () => {
    const rows = await listFor(instA);

    const platformRow = rows.find((row) => row.id === platformRowId);
    expect(platformRow).toMatchObject({
      scope: 'platform',
      tenantId: null,
      action: 'adminSuspendInstitute',
    });
    expect(platformRow?.actorName).toEqual(expect.any(String));
    expect(rows.find((row) => row.id === ownRowId)?.scope).toBe('institute');
  });

  it("hides the platform staff member's IP address and browser from the institute, not its own", async () => {
    const rows = await listFor(instA);

    expect(rows.find((row) => row.id === platformRowId)).toMatchObject({
      ipAddress: null,
      userAgent: null,
    });
    expect(rows.find((row) => row.id === ownRowId)).toMatchObject({
      ipAddress: '203.0.113.7',
      userAgent: 'platform-staff-browser',
    });
  });

  it('gives the institute the stated reason and nothing else from the platform request', async () => {
    const platformRow = (await listFor(instA)).find((row) => row.id === platformRowId);

    expect(platformRow?.metadata).toEqual({ reason: 'Fees unpaid' });
    expect(platformRow?.impersonatorId).toBeNull();
  });

  it('shows another institute neither row', async () => {
    const ids = (await listFor(instB)).map((row) => row.id);

    expect(ids).not.toContain(platformRowId);
    expect(ids).not.toContain(ownRowId);
  });

  it('is enforced by the database: only the subject institute can select the row', async () => {
    const visibleTo = (tenantId: string) =>
      withTenant(app.db, mkInstituteCtx(tenantId, ORIGIN), (tx) =>
        tx.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.id, platformRowId)),
      );

    expect(await visibleTo(instA.tenantId)).toEqual([{ id: platformRowId }]);
    expect(await visibleTo(instB.tenantId)).toEqual([]);
  });

  it('refuses a subject institute on an institute-scoped row', async () => {
    const insert = withAdmin(app.db, mkAdminCtx(ORIGIN), (tx) =>
      tx.insert(auditLogs).values({
        ...base,
        id: randomUUID(),
        scope: 'institute',
        tenantId: instA.tenantId,
        subjectTenantId: instB.tenantId,
        action: 'probe',
        entityId: null,
      }),
    );

    await expect(insert).rejects.toThrow();
  });

  it("clears a reseller row's subject when the institute is not that reseller's", async () => {
    const ownId = randomUUID();
    const foreignId = randomUUID();
    const otherReseller = await createTestReseller(app.db);
    const [owner] = await withAdmin(app.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .select({ resellerId: institutes.resellerId })
        .from(institutes)
        .where(eq(institutes.id, instA.tenantId)),
    );
    assert(owner);
    try {
      const resellerRow = {
        ...base,
        scope: 'reseller',
        tenantId: null,
        subjectTenantId: instA.tenantId,
        action: 'resellerSuspendInstitute',
        entityId: instA.tenantId,
      };
      const stored = await withAdmin(app.db, mkAdminCtx(ORIGIN), async (tx) => {
        await tx.insert(auditLogs).values([
          { ...resellerRow, id: ownId, resellerId: owner.resellerId },
          { ...resellerRow, id: foreignId, resellerId: otherReseller.resellerId },
        ]);
        return tx
          .select({ id: auditLogs.id, subjectTenantId: auditLogs.subjectTenantId })
          .from(auditLogs)
          .where(inArray(auditLogs.id, [ownId, foreignId]));
      });

      expect(stored.find((row) => row.id === ownId)?.subjectTenantId).toBe(instA.tenantId);
      expect(stored.find((row) => row.id === foreignId)?.subjectTenantId).toBeNull();
      // So institute A never reads what the other reseller wrote.
      expect((await listFor(instA)).map((row) => row.id)).not.toContain(foreignId);
    } finally {
      await withAdmin(app.db, mkAdminCtx(ORIGIN), (tx) =>
        tx.delete(auditLogs).where(inArray(auditLogs.id, [ownId, foreignId])),
      );
      await cleanupTestReseller(app.db, otherReseller);
    }
  });

  it('names the institute on the audit event of a platform mutation that acts on it', async () => {
    published.length = 0;
    const platformToken = createPlatformToken({
      sub: SEED_IDS.USER_ADMIN,
      membershipId: randomUUID(),
      roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
    });

    await gqlRequest(app.httpServer, {
      query: /* GraphQL */ `
        mutation ($id: ID!) {
          adminSuspendInstitute(id: $id, reason: "ROV-311 integration check") {
            id
          }
        }
      `,
      variables: { id: instA.tenantId },
      token: platformToken,
    });

    await vi.waitFor(() => {
      const event = published.find(
        (entry) =>
          entry.pattern === 'AUDIT.log' && entry.payload.action === 'adminSuspendInstitute',
      );
      expect(event?.payload).toMatchObject({
        scope: 'platform',
        tenantId: null,
        subjectTenantId: instA.tenantId,
      });
    });
  });
});
