/**
 * ROV-302 / ROV-297 — an institute's own files count against the storage its plan allows, an
 * upload over the limit is refused for that institute only, and the platform sees usage per
 * institute.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ErrorCode, type FileStatus } from '@roviq/common-types';
import { files, mkAdminCtx, withAdmin } from '@roviq/database';
import { EntitlementService } from '@roviq/entitlements';
import { FakeStorageClient, StorageClient } from '@roviq/storage';
import {
  cleanupTestInstitute,
  cleanupTestReseller,
  createInstituteToken,
  createIntegrationApp,
  createMock,
  createPlatformToken,
  createResellerToken,
  createTestInstitute,
  createTestReseller,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
  type TestReseller,
} from '@roviq/testing/integration';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SEED_IDS } from '../../../../../e2e/shared/seed-fixtures';
import { PrometheusClient } from '../../admin/monitoring/prometheus.client';
import { AppModule } from '../../app/app.module';

const ORIGIN = 'test:storage-quota';
const MB = 1024 * 1024;
const LIMIT_A = 10 * MB;

const REQUEST_UPLOAD = /* GraphQL */ `
  mutation RequestUpload($input: RequestFileUploadInput!) {
    requestFileUpload(input: $input) {
      fileId
    }
  }
`;
const USAGE = /* GraphQL */ `
  query {
    storageUsage {
      usedBytes
      limitBytes
    }
  }
`;
const ANALYTICS = /* GraphQL */ `
  query ($resellerId: ID) {
    adminTenantAnalytics(first: 100, resellerId: $resellerId, sortBy: STORAGE_USED, sortOrder: DESC) {
      edges {
        node {
          instituteId
          storageUsedBytes
        }
      }
    }
  }
`;

describe('storage quota and usage (integration)', () => {
  let app: IntegrationAppResult;
  let reseller: TestReseller;
  let instA: TestInstitute;
  let instB: TestInstitute;
  let tokenA: string;
  let tokenB: string;
  const fileIds: string[] = [];

  // Institute A has a 10 MB plan; B's plan sets no limit.
  const entitlements = createMock<EntitlementService>({
    storageLimitBytes: vi.fn(async (tenantId: string) =>
      tenantId === instA.tenantId ? LIMIT_A : null,
    ),
  });

  const tokenFor = (inst: TestInstitute) =>
    createInstituteToken({
      sub: inst.userId,
      tenantId: inst.tenantId,
      membershipId: inst.membershipId,
      roleId: inst.roleId,
    });

  async function insertFile(
    owner: { tenantId: string | null; subjectUserId?: string },
    uploaderId: string,
    sizeBytes: number,
    status: FileStatus,
  ): Promise<string> {
    const id = await withAdmin(app.db, mkAdminCtx(ORIGIN), async (tx) => {
      const [row] = await tx
        .insert(files)
        .values({
          tenantId: owner.tenantId,
          subjectUserId: owner.subjectUserId ?? null,
          visibility: 'PRIVATE',
          purpose: owner.subjectUserId ? 'USER_DOCUMENT' : 'LEAVE_ATTACHMENT',
          objectKey: `test/storage-quota/${randomUUID()}.pdf`,
          originalName: 'file.pdf',
          contentType: 'application/pdf',
          sizeBytes,
          status,
          uploadedBy: uploaderId,
          createdBy: uploaderId,
          updatedBy: uploaderId,
        })
        .returning({ id: files.id });
      assert(row);
      return row.id;
    });
    fileIds.push(id);
    return id;
  }

  const setStatus = (id: string, status: FileStatus) =>
    withAdmin(app.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .update(files)
        .set({ status })
        .where(inArray(files.id, [id])),
    );

  const requestUpload = (token: string, sizeBytes: number) =>
    gqlRequest<{ requestFileUpload: { fileId: string } }>(app.httpServer, {
      query: REQUEST_UPLOAD,
      variables: {
        input: {
          purpose: 'LEAVE_ATTACHMENT',
          fileName: 'certificate.pdf',
          contentType: 'application/pdf',
          sizeBytes,
        },
      },
      token,
    });

  const usage = (token: string) =>
    gqlRequest<{ storageUsage: { usedBytes: number; limitBytes: number | null } }>(app.httpServer, {
      query: USAGE,
      token,
    });

  beforeAll(async () => {
    assert.equal(new URL(process.env.DATABASE_URL_TEST ?? '').pathname, '/roviq_test');
    app = await createIntegrationApp({
      modules: [AppModule],
      overrides: [
        { provide: StorageClient, useValue: new FakeStorageClient() },
        { provide: EntitlementService, useValue: entitlements },
        {
          provide: PrometheusClient,
          useValue: createMock<PrometheusClient>({
            query: vi.fn().mockResolvedValue([]),
            queryRange: vi.fn().mockResolvedValue([]),
          }),
        },
      ],
    });
    reseller = await createTestReseller(app.db);
    instA = await createTestInstitute(app.db, { resellerId: reseller.resellerId });
    instB = await createTestInstitute(app.db, { resellerId: reseller.resellerId });
    tokenA = tokenFor(instA);
    tokenB = tokenFor(instB);

    await insertFile({ tenantId: instA.tenantId }, instA.userId, 6 * MB, 'READY');
    // Not the institute's own storage: a document about a person.
    await insertFile(
      { tenantId: null, subjectUserId: instA.userId },
      instA.userId,
      50 * MB,
      'READY',
    );
    // No longer attached to anything.
    await insertFile({ tenantId: instA.tenantId }, instA.userId, 50 * MB, 'DELETED');
    await insertFile({ tenantId: instA.tenantId }, instA.userId, 50 * MB, 'REJECTED');
    await insertFile({ tenantId: instB.tenantId }, instB.userId, 2 * MB, 'READY');
  });

  afterAll(async () => {
    if (!app) return;
    await withAdmin(app.db, mkAdminCtx(ORIGIN), async (tx) => {
      const pending = await tx
        .select({ id: files.id })
        .from(files)
        .where(inArray(files.tenantId, [instA.tenantId, instB.tenantId]));
      const ids = [...new Set([...fileIds, ...pending.map((row) => row.id)])];
      if (ids.length > 0) await tx.delete(files).where(inArray(files.id, ids));
    });
    await cleanupTestInstitute(app.db, instA);
    await cleanupTestInstitute(app.db, instB);
    await cleanupTestReseller(app.db, reseller);
    await app.close();
  });

  it("reports only the institute's own attached files, with the limit of its plan", async () => {
    const a = await usage(tokenA);
    const b = await usage(tokenB);

    expect(a.errors).toBeUndefined();
    expect(a.data?.storageUsage).toEqual({ usedBytes: 6 * MB, limitBytes: LIMIT_A });
    expect(b.data?.storageUsage).toEqual({ usedBytes: 2 * MB, limitBytes: null });
  });

  it('refuses an upload that would cross the limit, and only for that institute', async () => {
    const overA = await requestUpload(tokenA, 4 * MB + 1);
    expect(overA.errors?.[0]?.extensions?.code).toBe(ErrorCode.STORAGE_QUOTA_EXCEEDED);

    // B's token asks for the same size while A is over: B is not affected.
    const sameForB = await requestUpload(tokenB, 4 * MB + 1);
    expect(sameForB.errors).toBeUndefined();
  });

  it('holds a pending upload against the limit, then frees the space when a file is deleted', async () => {
    const first = await requestUpload(tokenA, 3 * MB);
    expect(first.errors).toBeUndefined();
    const pendingId = first.data?.requestFileUpload.fileId;
    assert(pendingId);
    fileIds.push(pendingId);

    // 6 MB attached + 3 MB pending: 2 MB more does not fit in 10 MB.
    const second = await requestUpload(tokenA, 2 * MB);
    expect(second.errors?.[0]?.extensions?.code).toBe(ErrorCode.STORAGE_QUOTA_EXCEEDED);

    await setStatus(pendingId, 'DELETED');
    const third = await requestUpload(tokenA, 2 * MB);
    expect(third.errors).toBeUndefined();
  });

  it('shows the platform the storage used by each institute, sortable', async () => {
    const platformToken = createPlatformToken({
      sub: SEED_IDS.USER_ADMIN,
      membershipId: randomUUID(),
      roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
    });

    const res = await gqlRequest<{
      adminTenantAnalytics: {
        edges: { node: { instituteId: string; storageUsedBytes: number } }[];
      };
    }>(app.httpServer, {
      query: ANALYTICS,
      variables: { resellerId: reseller.resellerId },
      token: platformToken,
    });

    expect(res.errors).toBeUndefined();
    expect(res.data?.adminTenantAnalytics.edges.map((edge) => edge.node)).toEqual([
      { instituteId: instA.tenantId, storageUsedBytes: 6 * MB },
      { instituteId: instB.tenantId, storageUsedBytes: 2 * MB },
    ]);
  });

  it('refuses storageUsage to a reseller token and to a platform token', async () => {
    const resellerToken = createResellerToken({
      sub: reseller.userId,
      resellerId: reseller.resellerId,
      membershipId: reseller.membershipId,
      roleId: reseller.roleId,
    });
    const platformToken = createPlatformToken({
      sub: SEED_IDS.USER_ADMIN,
      membershipId: randomUUID(),
      roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
    });

    for (const token of [resellerToken, platformToken]) {
      const res = await usage(token);
      expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.FORBIDDEN);
    }
  });
});
