/**
 * ROV-302 / ROV-297 — an institute's own files and the files about its members count against
 * the storage its plan allows, an upload over the limit is refused for that institute only, and
 * the platform sees usage per institute. A person in two institutes counts in full for both.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ErrorCode, type FileStatus } from '@roviq/common-types';
import { files, memberships, mkAdminCtx, SYSTEM_USER_ID, withAdmin } from '@roviq/database';
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
import { eq, inArray } from 'drizzle-orm';
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
  let sharedMembershipId: string;

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

    // A's admin is also a member of B: that person's files count for both institutes.
    sharedMembershipId = await withAdmin(app.db, mkAdminCtx(ORIGIN), async (tx) => {
      const [row] = await tx
        .insert(memberships)
        .values({
          userId: instA.userId,
          roleId: instB.roleId,
          tenantId: instB.tenantId,
          abilities: [],
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning({ id: memberships.id });
      assert(row);
      return row.id;
    });

    await insertFile({ tenantId: instA.tenantId }, instA.userId, 5 * MB, 'READY');
    // A document about a person, owned by no institute.
    await insertFile({ tenantId: null, subjectUserId: instA.userId }, instA.userId, MB, 'READY');
    // About a member of B only: never counted for A.
    await insertFile(
      { tenantId: null, subjectUserId: instB.userId },
      instB.userId,
      4 * MB,
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
    await withAdmin(app.db, mkAdminCtx(ORIGIN), (tx) =>
      tx.delete(memberships).where(eq(memberships.id, sharedMembershipId)),
    );
    await cleanupTestInstitute(app.db, instA);
    await cleanupTestInstitute(app.db, instB);
    await cleanupTestReseller(app.db, reseller);
    await app.close();
  });

  it("reports the institute's attached files plus its members' files, with the limit of its plan", async () => {
    const a = await usage(tokenA);
    const b = await usage(tokenB);

    expect(a.errors).toBeUndefined();
    // A: 5 MB own + 1 MB about its admin. B: 2 MB own + 4 MB about its admin + the same 1 MB,
    // because A's admin is a member of B too.
    expect(a.data?.storageUsage).toEqual({ usedBytes: 6 * MB, limitBytes: LIMIT_A });
    expect(b.data?.storageUsage).toEqual({ usedBytes: 7 * MB, limitBytes: null });
  });

  it('refuses an upload that would cross the limit, and only for that institute', async () => {
    const overA = await requestUpload(tokenA, 4 * MB + 1);
    expect(overA.errors?.[0]?.extensions?.code).toBe(ErrorCode.STORAGE_QUOTA_EXCEEDED);

    // B's token asks for the same size while A is over: B is not affected.
    const sameForB = await requestUpload(tokenB, 4 * MB + 1);
    expect(sameForB.errors).toBeUndefined();
  });

  it("refuses a file about a person too once the institute's storage is used up", async () => {
    const res = await gqlRequest<{ requestFileUpload: { fileId: string } }>(app.httpServer, {
      query: REQUEST_UPLOAD,
      variables: {
        input: {
          purpose: 'USER_DOCUMENT',
          fileName: 'birth-certificate.pdf',
          contentType: 'application/pdf',
          sizeBytes: 4 * MB + 1,
          subjectUserId: instA.userId,
        },
      },
      token: tokenA,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.STORAGE_QUOTA_EXCEEDED);
  });

  it('holds a pending upload against the limit, then frees the space when a file is deleted', async () => {
    const first = await requestUpload(tokenA, 3 * MB);
    expect(first.errors).toBeUndefined();
    const pendingId = first.data?.requestFileUpload.fileId;
    assert(pendingId);
    fileIds.push(pendingId);

    // 6 MB counted + 3 MB pending: 2 MB more does not fit in 10 MB.
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
      { instituteId: instB.tenantId, storageUsedBytes: 7 * MB },
      { instituteId: instA.tenantId, storageUsedBytes: 6 * MB },
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
