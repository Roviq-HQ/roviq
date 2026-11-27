/**
 * ROV-293: reseller operations that take an institute, group or file id refuse one of
 * another reseller (and a platform-owned institute), return none of it and change nothing.
 * Branding refuses a logo or favicon uploaded by another reseller or belonging to an institute.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ErrorCode, GroupType } from '@roviq/common-types';
import {
  type DrizzleDB,
  files,
  instituteGroups,
  institutes,
  mkAdminCtx,
  resellers,
  SYSTEM_USER_ID,
  withAdmin,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import { FakeStorageClient, StorageClient } from '@roviq/storage';
import {
  createIntegrationApp,
  createResellerToken,
  createTestInstitute,
  createTestReseller,
  type IntegrationAppResult,
  type TestInstitute,
  type TestReseller,
} from '@roviq/testing/integration';
import { asc, eq, inArray, or } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { foreignIdRequests } from '../../__tests__/foreign-id-requests';
import { AppModule } from '../../app/app.module';
import { EicarFileScanner } from '../../files/scan/eicar-file-scanner';
import { FileScanner } from '../../files/scan/file-scanner';

const ORIGIN = 'test:reseller-foreign-id';

const GET_INSTITUTE = 'query ($id: ID!) { resellerGetInstitute(id: $id) { id } }';
const ADD = /* GraphQL */ `
  mutation ($instituteId: ID!, $groupId: ID!) {
    resellerAddInstituteToGroup(instituteId: $instituteId, groupId: $groupId)
  }
`;
const REMOVE = /* GraphQL */ `
  mutation ($instituteId: ID!) {
    resellerRemoveInstituteFromGroup(instituteId: $instituteId)
  }
`;
const UPDATE_BRANDING = /* GraphQL */ `
  mutation ($input: ResellerUpdateBrandingInput!) {
    resellerUpdateBranding(input: $input) {
      id
      logo {
        id
      }
      favicon {
        id
      }
    }
  }
`;

type BrandingPurpose =
  | 'RESELLER_LOGO'
  | 'RESELLER_FAVICON'
  | 'INSTITUTE_LOGO'
  | 'INSTITUTE_FAVICON';
type Owner = { resellerId: string } | { tenantId: string };

describe('reseller operations: another reseller id (ROV-293)', () => {
  let result: IntegrationAppResult;
  let resellerA: TestReseller;
  let resellerB: TestReseller;
  let ownInstitute: TestInstitute;
  let spareInstitute: TestInstitute;
  let foreignInstitute: TestInstitute;
  let platformInstitute: TestInstitute;
  let ownGroupId: string;
  let foreignGroupId: string;
  let token: string;

  /** Uploads the caller's reseller may not attach to its branding. */
  const unusable: string[] = [];
  const request = foreignIdRequests({
    httpServer: () => result.httpServer,
    foreignIds: () => [resellerB, foreignInstitute, platformInstitute, foreignGroupId, unusable],
    specFile: __filename,
  });
  const storage = new FakeStorageClient();
  const uploaderIds: string[] = [];

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  const addGroup = (resellerId: string, label: string) =>
    asAdmin(async (tx) => {
      const [group] = await tx
        .insert(instituteGroups)
        .values({
          name: label,
          code: `${label}-${randomUUID().slice(0, 8)}`,
          type: GroupType.TRUST,
          resellerId,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        })
        .returning({ id: instituteGroups.id });
      assert(group);
      return group.id;
    });

  /** A branding image as `requestFileUpload` leaves it: a PENDING row and the bytes in storage. */
  const pendingImage = async (owner: Owner, purpose: BrandingPurpose, uploadedBy: string) => {
    const bytes = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 40, b: 40 } },
    })
      .png()
      .toBuffer();
    const prefix =
      'resellerId' in owner ? `resellers/${owner.resellerId}` : `institutes/${owner.tenantId}`;
    const objectKey = `${prefix}/${purpose.toLowerCase().replace('_', '-')}/${randomUUID()}.png`;
    await storage.put('private', `pending/${objectKey}`, bytes, { contentType: 'image/png' });
    uploaderIds.push(uploadedBy);
    const [row] = await asAdmin((tx) =>
      tx
        .insert(files)
        .values({
          ...owner,
          visibility: 'PUBLIC',
          purpose,
          objectKey,
          originalName: 'brand.png',
          contentType: 'image/png',
          sizeBytes: bytes.length,
          status: 'PENDING',
          uploadedBy,
          createdBy: uploadedBy,
          updatedBy: uploadedBy,
        })
        .returning({ id: files.id }),
    );
    assert(row);
    return row.id;
  };

  const instituteIds = () =>
    [ownInstitute, spareInstitute, foreignInstitute, platformInstitute].map((i) => i.tenantId);

  /** Both resellers, their institutes and groups, and every file either side owns or uploaded. */
  const snapshot = () =>
    asAdmin(async (tx) => {
      const resellerIds = [resellerA.resellerId, resellerB.resellerId];
      return {
        resellers: await tx
          .select()
          .from(resellers)
          .where(inArray(resellers.id, resellerIds))
          .orderBy(asc(resellers.id)),
        institutes: await tx
          .select()
          .from(institutes)
          .where(inArray(institutes.id, instituteIds()))
          .orderBy(asc(institutes.id)),
        groups: await tx
          .select()
          .from(instituteGroups)
          .where(inArray(instituteGroups.resellerId, resellerIds))
          .orderBy(asc(instituteGroups.id)),
        files: await tx
          .select()
          .from(files)
          .where(
            or(
              inArray(files.resellerId, resellerIds),
              inArray(files.tenantId, instituteIds()),
              inArray(files.uploadedBy, [resellerA.userId, resellerB.userId, ...uploaderIds]),
            ),
          )
          .orderBy(asc(files.id)),
      };
    });

  const call = <T>(source: string, variables: Record<string, unknown>) =>
    request<T>({ query: source, variables, token });

  const refusesAndWritesNothing = async (
    source: string,
    variables: Record<string, unknown>,
    code: string,
  ) => {
    const before = await snapshot();
    const emit = vi.spyOn(EventBusService.prototype, 'emit');
    const put = vi.spyOn(storage, 'put');
    const remove = vi.spyOn(storage, 'delete');

    const res = await call(source, variables);

    expect(res.errors?.[0]?.extensions?.code).toBe(code);
    expect(res.data).toBeNull();
    expect(await snapshot()).toEqual(before);
    expect(emit.mock.calls.map(([pattern]) => pattern)).toEqual([]);
    expect(put).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  };

  const versionOfA = async () => {
    const [row] = await asAdmin((tx) =>
      tx
        .select({ version: resellers.version })
        .from(resellers)
        .where(eq(resellers.id, resellerA.resellerId)),
    );
    assert(row);
    return row.version;
  };

  beforeAll(async () => {
    result = await createIntegrationApp({
      modules: [AppModule],
      overrides: [
        { provide: StorageClient, useValue: storage },
        { provide: FileScanner, useValue: new EicarFileScanner() },
        {
          provide: 'JETSTREAM_CLIENT',
          useValue: {
            emit: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }),
            send: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }),
            connect: async () => undefined,
            close: async () => undefined,
          },
        },
      ],
    });
    resellerA = await createTestReseller(result.db);
    resellerB = await createTestReseller(result.db);
    ownInstitute = await createTestInstitute(result.db, { resellerId: resellerA.resellerId });
    spareInstitute = await createTestInstitute(result.db, { resellerId: resellerA.resellerId });
    foreignInstitute = await createTestInstitute(result.db, { resellerId: resellerB.resellerId });
    platformInstitute = await createTestInstitute(result.db);
    ownGroupId = await addGroup(resellerA.resellerId, 'own');
    foreignGroupId = await addGroup(resellerB.resellerId, 'foreign');
    // The foreign institute sits in its reseller's group, so removing it would change a row.
    await asAdmin((tx) =>
      tx
        .update(institutes)
        .set({ groupId: foreignGroupId })
        .where(eq(institutes.id, foreignInstitute.tenantId)),
    );
    token = createResellerToken({
      sub: resellerA.userId,
      resellerId: resellerA.resellerId,
      membershipId: resellerA.membershipId,
      roleId: resellerA.roleId,
    });
  });

  afterAll(async () => {
    await result?.close();
  });

  describe('resellerGetInstitute', () => {
    it('should read its own institute', async () => {
      const res = await call(GET_INSTITUTE, { id: ownInstitute.tenantId });

      expect(res.errors).toBeUndefined();
      expect(res.data).toEqual({ resellerGetInstitute: { id: ownInstitute.tenantId } });
    });

    it.each([
      ['another reseller', () => foreignInstitute.tenantId],
      ['the platform', () => platformInstitute.tenantId],
    ])('should refuse an institute of %s', async (_owner, id) => {
      await refusesAndWritesNothing(GET_INSTITUTE, { id: id() }, ErrorCode.INSTITUTE_NOT_FOUND);
    });
  });

  describe('resellerAddInstituteToGroup', () => {
    it('should add its own institute to its own group', async () => {
      const res = await call(ADD, { instituteId: spareInstitute.tenantId, groupId: ownGroupId });

      expect(res.errors).toBeUndefined();
      expect(res.data).toEqual({ resellerAddInstituteToGroup: true });
      const [row] = await asAdmin((tx) =>
        tx
          .select({ groupId: institutes.groupId })
          .from(institutes)
          .where(eq(institutes.id, spareInstitute.tenantId)),
      );
      expect(row).toEqual({ groupId: ownGroupId });
    });

    it.each([
      [
        'an institute of another reseller',
        () => ({ instituteId: foreignInstitute.tenantId, groupId: ownGroupId }),
        ErrorCode.INSTITUTE_NOT_FOUND,
      ],
      [
        'a platform-owned institute',
        () => ({ instituteId: platformInstitute.tenantId, groupId: ownGroupId }),
        ErrorCode.INSTITUTE_NOT_FOUND,
      ],
      [
        'a group of another reseller',
        () => ({ instituteId: ownInstitute.tenantId, groupId: foreignGroupId }),
        ErrorCode.INSTITUTE_GROUP_NOT_FOUND,
      ],
    ])('should refuse %s', async (_label, variables, code) => {
      await refusesAndWritesNothing(ADD, variables(), code);
    });
  });

  describe('resellerRemoveInstituteFromGroup', () => {
    it('should refuse an institute of another reseller', async () => {
      await refusesAndWritesNothing(
        REMOVE,
        { instituteId: foreignInstitute.tenantId },
        ErrorCode.INSTITUTE_NOT_FOUND,
      );
    });
  });

  describe('resellerUpdateBranding', () => {
    // An institute can upload only its own purposes, so its files carry those.
    const slots = [
      ['logoFileId', 'RESELLER_LOGO', 'INSTITUTE_LOGO'],
      ['faviconFileId', 'RESELLER_FAVICON', 'INSTITUTE_FAVICON'],
    ] as const;

    it.each(slots)('should attach its own pending upload as %s', async (field, purpose) => {
      const fileId = await pendingImage(
        { resellerId: resellerA.resellerId },
        purpose,
        resellerA.userId,
      );

      const res = await call<{ resellerUpdateBranding: Record<string, unknown> }>(UPDATE_BRANDING, {
        input: { version: await versionOfA(), [field]: fileId },
      });

      expect(res.errors).toBeUndefined();
      expect(res.data?.resellerUpdateBranding[field === 'logoFileId' ? 'logo' : 'favicon']).toEqual(
        {
          id: fileId,
        },
      );
    });

    describe.each(slots)('%s', (field, purpose, institutePurpose) => {
      it.each([
        [
          'a pending upload of another reseller',
          () => pendingImage({ resellerId: resellerB.resellerId }, purpose, resellerB.userId),
        ],
        [
          'a file of another reseller recorded as uploaded by the caller',
          () => pendingImage({ resellerId: resellerB.resellerId }, purpose, resellerA.userId),
        ],
        [
          "an upload of another reseller's institute",
          () =>
            pendingImage(
              { tenantId: foreignInstitute.tenantId },
              institutePurpose,
              foreignInstitute.userId,
            ),
        ],
        [
          "an upload of the caller's own institute",
          () =>
            pendingImage(
              { tenantId: ownInstitute.tenantId },
              institutePurpose,
              ownInstitute.userId,
            ),
        ],
        [
          // The same person may also be a member of the institute; the reseller can read its files.
          "an upload of the caller's own institute made by the caller",
          () =>
            pendingImage({ tenantId: ownInstitute.tenantId }, institutePurpose, resellerA.userId),
        ],
      ])('should refuse %s', async (_label, upload) => {
        const fileId = await upload();
        unusable.push(fileId);

        await refusesAndWritesNothing(
          UPDATE_BRANDING,
          { input: { version: await versionOfA(), [field]: fileId } },
          ErrorCode.FILE_NOT_FOUND,
        );
      });
    });
  });
});
