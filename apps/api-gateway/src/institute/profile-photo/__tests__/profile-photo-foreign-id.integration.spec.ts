/**
 * ROV-293: setMyProfilePhoto refuses a picture uploaded in another institute and changes no
 * profile and no file.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ErrorCode } from '@roviq/common-types';
import {
  type DrizzleDB,
  files,
  mkAdminCtx,
  SYSTEM_USER_ID,
  tenantUserProfiles,
  userProfiles,
  withAdmin,
} from '@roviq/database';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';

const ORIGIN = 'test:profile-photo-foreign-id';

const SET_MY_PHOTO = /* GraphQL */ `
  mutation SetMyProfilePhoto($fileId: ID) {
    setMyProfilePhoto(fileId: $fileId)
  }
`;

describe('setMyProfilePhoto: a picture of another institute (ROV-293)', () => {
  let result: IntegrationAppResult;
  let instA: TestInstitute;
  let instB: TestInstitute;
  let tokenA: string;
  let aboutOtherPerson: string;
  let aboutCaller: string;

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  const pendingPhoto = (subjectUserId: string, uploadedBy: string) =>
    asAdmin(async (tx) => {
      const [row] = await tx
        .insert(files)
        .values({
          subjectUserId,
          visibility: 'PRIVATE',
          purpose: 'PROFILE_PHOTO',
          objectKey: `users/${subjectUserId}/profile-photo/${randomUUID()}.jpg`,
          originalName: 'me.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 2048,
          status: 'PENDING',
          uploadedBy,
          createdBy: uploadedBy,
          updatedBy: uploadedBy,
        })
        .returning({ id: files.id });
      assert(row);
      return row.id;
    });

  const stored = () =>
    asAdmin(async (tx) => {
      const people = [instA.userId, instB.userId];
      return {
        files: await tx
          .select()
          .from(files)
          .where(inArray(files.id, [aboutOtherPerson, aboutCaller])),
        accounts: await tx.select().from(userProfiles).where(inArray(userProfiles.userId, people)),
        copies: await tx
          .select()
          .from(tenantUserProfiles)
          .where(inArray(tenantUserProfiles.userId, people)),
      };
    });

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
    await asAdmin((tx) =>
      tx.insert(userProfiles).values(
        [instA.userId, instB.userId].map((userId) => ({
          userId,
          firstName: { en: 'Asha' },
          lastName: { en: 'Verma' },
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })),
      ),
    );
    aboutOtherPerson = await pendingPhoto(instB.userId, instB.userId);
    aboutCaller = await pendingPhoto(instA.userId, instB.userId);
  });

  afterAll(async () => {
    await result?.close();
  });

  it.each([
    ['a picture of a person of another institute', () => aboutOtherPerson],
    ['a picture of the caller uploaded by another institute', () => aboutCaller],
  ])('should refuse %s and change nothing', async (_label, fileId) => {
    const before = await stored();

    const res = await gqlRequest<{ setMyProfilePhoto: boolean }>(result.httpServer, {
      query: SET_MY_PHOTO,
      variables: { fileId: fileId() },
      token: tokenA,
    });

    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.FILE_NOT_FOUND);
    expect(res.data).toBeNull();
    expect(await stored()).toEqual(before);
  });
});
