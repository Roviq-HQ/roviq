/**
 * ROV-293: requestFileUpload, fileDownloadUrl and resellerRequestFileUpload refuse a person or a
 * file of another institute or reseller, and write nothing.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { type DrizzleDB, files, mkAdminCtx, withAdmin } from '@roviq/database';
import {
  createInstituteToken,
  createIntegrationApp,
  createResellerToken,
  createTestInstitute,
  createTestReseller,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
  type TestReseller,
} from '@roviq/testing/integration';
import { eq, or } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { foreignIdRequests } from '../../__tests__/foreign-id-requests';
import { AppModule } from '../../app/app.module';

const ORIGIN = 'test:files-foreign-id';

const REQUEST_UPLOAD = /* GraphQL */ `
  mutation RequestUpload($input: RequestFileUploadInput!) {
    requestFileUpload(input: $input) {
      fileId
      uploadUrl
    }
  }
`;
const RESELLER_REQUEST_UPLOAD = /* GraphQL */ `
  mutation ResellerRequestUpload($input: RequestFileUploadInput!) {
    resellerRequestFileUpload(input: $input) {
      fileId
      uploadUrl
    }
  }
`;
const DOWNLOAD_URL = /* GraphQL */ `
  mutation DownloadUrl($fileId: ID!) {
    fileDownloadUrl(fileId: $fileId)
  }
`;

describe('files: another institute or reseller id (ROV-293)', () => {
  let result: IntegrationAppResult;
  let resellerOwn: TestReseller;
  let resellerOther: TestReseller;
  let instA: TestInstitute;
  let instB: TestInstitute;
  let instDirect: TestInstitute;
  let instituteFileB: string;
  let personFileB: string;

  const request = foreignIdRequests({
    httpServer: () => result.httpServer,
    foreignIds: () => [resellerOther, instB, instDirect, instituteFileB, personFileB],
    specFile: __filename,
  });

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

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  /** Every file uploaded by `userId` or about `subjectUserId`. */
  const filesOf = (userId: string, subjectUserId: string) =>
    asAdmin((tx) =>
      tx
        .select()
        .from(files)
        .where(or(eq(files.uploadedBy, userId), eq(files.subjectUserId, subjectUserId))),
    );

  const fileRow = async (id: string) => {
    const [row] = await asAdmin((tx) => tx.select().from(files).where(eq(files.id, id)));
    assert(row);
    return row;
  };

  const insertReadyFile = (values: {
    tenantId: string | null;
    subjectUserId: string | null;
    purpose: 'COMPLIANCE_EXPORT' | 'PROFILE_PHOTO';
    uploadedBy: string;
  }) =>
    asAdmin(async (tx) => {
      const [row] = await tx
        .insert(files)
        .values({
          ...values,
          visibility: 'PRIVATE',
          objectKey: `foreign-id/${randomUUID()}.${values.purpose === 'PROFILE_PHOTO' ? 'jpg' : 'pdf'}`,
          originalName: values.purpose === 'PROFILE_PHOTO' ? 'me.jpg' : 'export.pdf',
          contentType: values.purpose === 'PROFILE_PHOTO' ? 'image/jpeg' : 'application/pdf',
          sizeBytes: 2048,
          status: 'READY',
          createdBy: values.uploadedBy,
          updatedBy: values.uploadedBy,
        })
        .returning({ id: files.id });
      assert(row);
      return row.id;
    });

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    resellerOwn = await createTestReseller(result.db);
    resellerOther = await createTestReseller(result.db);
    instA = await createTestInstitute(result.db, { resellerId: resellerOwn.resellerId });
    instB = await createTestInstitute(result.db, { resellerId: resellerOther.resellerId });
    instDirect = await createTestInstitute(result.db);
    instituteFileB = await insertReadyFile({
      tenantId: instB.tenantId,
      subjectUserId: null,
      purpose: 'COMPLIANCE_EXPORT',
      uploadedBy: instB.userId,
    });
    personFileB = await insertReadyFile({
      tenantId: null,
      subjectUserId: instB.userId,
      purpose: 'PROFILE_PHOTO',
      uploadedBy: instB.userId,
    });
  });

  afterAll(async () => {
    await result?.close();
  });

  describe('requestFileUpload (institute scope)', () => {
    it.each([
      ['PROFILE_PHOTO', 'image/jpeg', 'me.jpg'],
      ['USER_DOCUMENT', 'application/pdf', 'aadhaar.pdf'],
    ])('should refuse a %s upload about a member of another institute and store no file', async (purpose, contentType, fileName) => {
      const before = await filesOf(instA.userId, instB.userId);

      const res = await request<{ requestFileUpload: { fileId: string } }>({
        query: REQUEST_UPLOAD,
        variables: {
          input: { purpose, contentType, fileName, sizeBytes: 2048, subjectUserId: instB.userId },
        },
        token: instituteToken(),
      });

      expect(res.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
      expect(res.data).toBeNull();
      expect(await filesOf(instA.userId, instB.userId)).toEqual(before);
    });
  });

  describe('fileDownloadUrl (institute scope)', () => {
    it.each([
      ['a file of another institute', () => instituteFileB],
      ['a picture of a person of another institute', () => personFileB],
    ])('should refuse %s and leave it unchanged', async (_label, fileId) => {
      const before = await fileRow(fileId());

      const res = await request<{ fileDownloadUrl: string }>({
        query: DOWNLOAD_URL,
        variables: { fileId: fileId() },
        token: instituteToken(),
      });

      expect(res.errors?.[0]?.extensions?.code).toBe('FILE_NOT_FOUND');
      expect(res.data).toBeNull();
      expect(await fileRow(fileId())).toEqual(before);
    });
  });

  describe('resellerRequestFileUpload (reseller scope)', () => {
    it.each([
      ['an institute of another reseller', () => instB.userId],
      ['a platform-owned institute', () => instDirect.userId],
    ])('should refuse a picture upload about a member of %s and store no file', async (_label, subjectUserId) => {
      const before = await filesOf(resellerOwn.userId, subjectUserId());

      const res = await request<{ resellerRequestFileUpload: { fileId: string } }>({
        query: RESELLER_REQUEST_UPLOAD,
        variables: {
          input: {
            purpose: 'PROFILE_PHOTO',
            contentType: 'image/jpeg',
            fileName: 'me.jpg',
            sizeBytes: 2048,
            subjectUserId: subjectUserId(),
          },
        },
        token: resellerToken(),
      });

      expect(res.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
      expect(res.data).toBeNull();
      expect(await filesOf(resellerOwn.userId, subjectUserId())).toEqual(before);
    });

    it.each([
      ['an institute of another reseller', () => instB.userId],
      ['a platform-owned institute', () => instDirect.userId],
    ])('should store its own logo with no link to a member of %s', async (_label, subjectUserId) => {
      const res = await gqlRequest<{ resellerRequestFileUpload: { fileId: string } }>(
        result.httpServer,
        {
          query: RESELLER_REQUEST_UPLOAD,
          variables: {
            input: {
              purpose: 'RESELLER_LOGO',
              contentType: 'image/png',
              fileName: 'logo.png',
              sizeBytes: 2048,
              subjectUserId: subjectUserId(),
            },
          },
          token: resellerToken(),
        },
      );

      expect(res.errors).toBeUndefined();
      assert(res.data);
      const stored = await fileRow(res.data.resellerRequestFileUpload.fileId);
      expect({
        resellerId: stored.resellerId,
        tenantId: stored.tenantId,
        subjectUserId: stored.subjectUserId,
        status: stored.status,
      }).toEqual({
        resellerId: resellerOwn.resellerId,
        tenantId: null,
        subjectUserId: null,
        status: 'PENDING',
      });
    });
  });
});
