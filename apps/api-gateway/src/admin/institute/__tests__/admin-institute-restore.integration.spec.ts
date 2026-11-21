/** Deleting an institute, finding it in the deleted list and restoring it (platform only). */
import { randomUUID } from 'node:crypto';
import {
  cleanupTestInstitute,
  createInstituteToken,
  createIntegrationApp,
  createPlatformToken,
  createResellerToken,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
  RESELLER_DIRECT_ID,
  type TestInstitute,
} from '@roviq/testing/integration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../../../../../e2e/shared/seed-fixtures';
import { AppModule } from '../../../app/app.module';

const LIST = 'query { adminListDeletedInstitutes { id slug status deletedAt } }';
const DELETE = 'mutation ($id: ID!) { adminDeleteInstitute(id: $id) }';
const RESTORE = 'mutation ($id: ID!) { adminRestoreInstitute(id: $id) { id status } }';
const ME = 'query { me { id } }';

interface DeletedRow {
  id: string;
  slug: string;
  status: string;
  deletedAt: string;
}

describe('Admin institute delete and restore (integration)', () => {
  let result: IntegrationAppResult;
  let institute: TestInstitute;
  let platformToken: string;
  let memberToken: string;

  const deletedIds = async () => {
    const res = await gqlRequest<{ adminListDeletedInstitutes: DeletedRow[] }>(result.httpServer, {
      query: LIST,
      token: platformToken,
    });
    expect(res.errors).toBeUndefined();
    return res.data?.adminListDeletedInstitutes ?? [];
  };

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    institute = await createTestInstitute(result.db);
    platformToken = createPlatformToken({
      sub: SEED_IDS.USER_ADMIN,
      membershipId: randomUUID(),
      roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
    });
    memberToken = createInstituteToken({
      sub: institute.userId,
      tenantId: institute.tenantId,
      membershipId: institute.membershipId,
      roleId: institute.roleId,
    });
  });

  afterAll(async () => {
    await cleanupTestInstitute(result.db, institute);
    await result?.close();
  });

  it('lists a deleted institute, restores it with its status, and lets its members in again', async () => {
    expect((await deletedIds()).map((row) => row.id)).not.toContain(institute.tenantId);

    const removed = await gqlRequest(result.httpServer, {
      query: DELETE,
      token: platformToken,
      variables: { id: institute.tenantId },
    });
    expect(removed.errors).toBeUndefined();

    const listed = (await deletedIds()).find((row) => row.id === institute.tenantId);
    expect(listed).toMatchObject({ slug: institute.slug, status: 'ACTIVE' });
    expect(Number.isNaN(Date.parse(listed?.deletedAt ?? ''))).toBe(false);
    const whileDeleted = await gqlRequest(result.httpServer, { query: ME, token: memberToken });
    expect(whileDeleted.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');

    const restored = await gqlRequest<{ adminRestoreInstitute: { id: string; status: string } }>(
      result.httpServer,
      { query: RESTORE, token: platformToken, variables: { id: institute.tenantId } },
    );
    expect(restored.errors).toBeUndefined();
    expect(restored.data?.adminRestoreInstitute).toEqual({
      id: institute.tenantId,
      status: 'ACTIVE',
    });
    expect((await deletedIds()).map((row) => row.id)).not.toContain(institute.tenantId);
    // No waiting for a cache to expire: the restore re-opens the institute at once.
    const afterRestore = await gqlRequest(result.httpServer, { query: ME, token: memberToken });
    expect(afterRestore.errors).toBeUndefined();

    const again = await gqlRequest(result.httpServer, {
      query: RESTORE,
      token: platformToken,
      variables: { id: institute.tenantId },
    });
    expect(again.errors?.[0]?.extensions?.code).toBe('INSTITUTE_NOT_FOUND');
  });

  it('keeps the deleted list and restore from resellers and institute users', async () => {
    const resellerToken = createResellerToken({
      sub: randomUUID(),
      resellerId: RESELLER_DIRECT_ID,
      membershipId: randomUUID(),
      roleId: randomUUID(),
    });
    for (const token of [resellerToken, memberToken]) {
      const list = await gqlRequest(result.httpServer, { query: LIST, token });
      expect(list.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
      const restore = await gqlRequest(result.httpServer, {
        query: RESTORE,
        token,
        variables: { id: institute.tenantId },
      });
      expect(restore.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    }
  });
});
