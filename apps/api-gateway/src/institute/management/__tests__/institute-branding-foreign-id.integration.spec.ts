/**
 * ROV-293: updateInstituteBranding refuses an upload of another institute for each image and
 * changes neither institute's branding nor the file.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ErrorCode } from '@roviq/common-types';
import { type DrizzleDB, files, instituteBranding, mkAdminCtx, withAdmin } from '@roviq/database';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';
import { BRANDING_IMAGES } from '../branding-images';

const ORIGIN = 'test:institute-branding-foreign-id';

const UPDATE_BRANDING = /* GraphQL */ `
  mutation UpdateInstituteBranding($input: UpdateInstituteBrandingInput!) {
    updateInstituteBranding(input: $input) {
      id
    }
  }
`;

describe('updateInstituteBranding: uploads of another institute (ROV-293)', () => {
  let result: IntegrationAppResult;
  let instA: TestInstitute;
  let instB: TestInstitute;
  let tokenA: string;
  const foreignFiles = new Map<string, string>();

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  const brandingOf = (tenantId: string) =>
    asAdmin((tx) =>
      tx.select().from(instituteBranding).where(eq(instituteBranding.tenantId, tenantId)),
    );
  const fileRows = () =>
    asAdmin((tx) =>
      tx
        .select()
        .from(files)
        .where(inArray(files.id, [...foreignFiles.values()])),
    );

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    instA = await createTestInstitute(result.db);
    instB = await createTestInstitute(result.db);
    tokenA = createInstituteToken({
      sub: instA.userId,
      tenantId: instA.tenantId,
      membershipId: instA.membershipId,
      roleId: instA.roleId,
    });
    for (const { column, purpose } of BRANDING_IMAGES) {
      const id = await asAdmin(async (tx) => {
        const [row] = await tx
          .insert(files)
          .values({
            tenantId: instB.tenantId,
            visibility: 'PUBLIC',
            purpose,
            objectKey: `institutes/${instB.tenantId}/branding/${randomUUID()}.png`,
            originalName: 'logo.png',
            contentType: 'image/png',
            sizeBytes: 2048,
            status: 'PENDING',
            uploadedBy: instB.userId,
            createdBy: instB.userId,
            updatedBy: instB.userId,
          })
          .returning({ id: files.id });
        assert(row);
        return row.id;
      });
      foreignFiles.set(column, id);
    }
  });

  afterAll(async () => {
    await result?.close();
  });

  it.each(
    BRANDING_IMAGES.map(({ column }) => [column]),
  )('should refuse %s of another institute and change neither institute', async (column) => {
    const fileId = foreignFiles.get(column);
    assert(fileId);
    const before = {
      own: await brandingOf(instA.tenantId),
      other: await brandingOf(instB.tenantId),
      files: await fileRows(),
    };

    const res = await gqlRequest<{ updateInstituteBranding: { id: string } }>(result.httpServer, {
      query: UPDATE_BRANDING,
      variables: { input: { [column]: fileId } },
      token: tokenA,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.FILE_NOT_FOUND);
    expect(res.data).toBeNull();
    expect(await fileRows()).toEqual(before.files);
    expect(await brandingOf(instB.tenantId)).toEqual(before.other);
    expect(await brandingOf(instA.tenantId)).toEqual(before.own);
  });
});
