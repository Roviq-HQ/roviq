/**
 * ROV-293: the profile photo mutations refuse a student, staff member, guardian or picture of
 * another institute and change no profile and no file.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AdmissionType, ErrorCode } from '@roviq/common-types';
import {
  type DrizzleDB,
  files,
  guardianProfiles,
  memberships,
  mkAdminCtx,
  SYSTEM_USER_ID,
  staffProfiles,
  studentProfiles,
  tenantUserProfiles,
  userProfiles,
  users,
  withAdmin,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import { FakeStorageClient, StorageClient } from '@roviq/storage';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { asc, eq, inArray, or } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { foreignIdRequests } from '../../../__tests__/foreign-id-requests';
import { AppModule } from '../../../app/app.module';
import { EicarFileScanner } from '../../../files/scan/eicar-file-scanner';
import { FileScanner } from '../../../files/scan/file-scanner';

const ORIGIN = 'test:profile-photo-foreign-id';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

const SET_MY_PHOTO = /* GraphQL */ `
  mutation SetMyProfilePhoto($fileId: ID) {
    setMyProfilePhoto(fileId: $fileId)
  }
`;

const KINDS = {
  student: {
    query: /* GraphQL */ `
      mutation SetStudentPhoto($id: ID!, $fileId: ID) {
        setStudentPhoto(studentProfileId: $id, fileId: $fileId)
      }
    `,
    notFound: ErrorCode.STUDENT_NOT_FOUND,
  },
  staff: {
    query: /* GraphQL */ `
      mutation SetStaffPhoto($id: ID!, $fileId: ID) {
        setStaffPhoto(staffProfileId: $id, fileId: $fileId)
      }
    `,
    notFound: ErrorCode.STAFF_NOT_FOUND,
  },
  guardian: {
    query: /* GraphQL */ `
      mutation SetGuardianPhoto($id: ID!, $fileId: ID) {
        setGuardianPhoto(guardianProfileId: $id, fileId: $fileId)
      }
    `,
    notFound: ErrorCode.GUARDIAN_NOT_FOUND,
  },
} as const;
type Kind = keyof typeof KINDS;

interface Person {
  userId: string;
  profileId: string;
  /** The picture the institute already holds of the person. */
  photoId: string;
}

describe('profile photos: another institute id (ROV-293)', () => {
  let result: IntegrationAppResult;

  /** Files and profiles the caller's institute must not be able to use. */
  const foreign: string[] = [];
  /** People of the other institute: an upload about one of them is not the caller's to use. */
  const otherPeople = new Set<string>();
  const request = foreignIdRequests({
    httpServer: () => result.httpServer,
    foreignIds: () => [instB, foreign],
    specFile: __filename,
  });
  const storage = new FakeStorageClient();
  let instA: TestInstitute;
  let instB: TestInstitute;
  let tokenA: string;

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  /** A profile photo as `requestFileUpload` leaves it: a PENDING row and the bytes in storage. */
  const pendingPhoto = async (subjectUserId: string, uploadedBy: string) => {
    const bytes = await sharp({
      create: { width: 300, height: 200, channels: 3, background: { r: 10, g: 90, b: 160 } },
    })
      .jpeg()
      .toBuffer();
    const objectKey = `users/${subjectUserId}/profile-photo/${randomUUID()}.jpg`;
    await storage.put('private', `pending/${objectKey}`, bytes, { contentType: 'image/jpeg' });
    const [row] = await asAdmin((tx) =>
      tx
        .insert(files)
        .values({
          subjectUserId,
          visibility: 'PRIVATE',
          purpose: 'PROFILE_PHOTO',
          objectKey,
          originalName: 'me.jpg',
          contentType: 'image/jpeg',
          sizeBytes: bytes.length,
          status: 'PENDING',
          uploadedBy,
          createdBy: uploadedBy,
          updatedBy: uploadedBy,
        })
        .returning({ id: files.id }),
    );
    assert(row);
    if (uploadedBy !== instA.userId || otherPeople.has(subjectUserId)) foreign.push(row.id);
    return row.id;
  };

  beforeAll(async () => {
    result = await createIntegrationApp({
      modules: [AppModule],
      overrides: [
        { provide: StorageClient, useValue: storage },
        { provide: FileScanner, useValue: new EicarFileScanner() },
      ],
    });
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
          ...BY,
        })),
      ),
    );
  });

  afterAll(async () => {
    await result?.close();
  });

  describe('setMyProfilePhoto', () => {
    let aboutOtherPerson: string;
    let aboutCaller: string;

    const stored = () =>
      asAdmin(async (tx) => {
        const people = [instA.userId, instB.userId];
        return {
          files: await tx
            .select()
            .from(files)
            .where(inArray(files.id, [aboutOtherPerson, aboutCaller])),
          accounts: await tx
            .select()
            .from(userProfiles)
            .where(inArray(userProfiles.userId, people)),
          copies: await tx
            .select()
            .from(tenantUserProfiles)
            .where(inArray(tenantUserProfiles.userId, people)),
        };
      });

    beforeAll(async () => {
      aboutOtherPerson = await pendingPhoto(instB.userId, instB.userId);
      aboutCaller = await pendingPhoto(instA.userId, instB.userId);
    });

    it.each([
      ['a picture of a person of another institute', () => aboutOtherPerson],
      ['a picture of the caller uploaded by another institute', () => aboutCaller],
    ])('should refuse %s and change nothing', async (_label, fileId) => {
      const before = await stored();

      const res = await request<{ setMyProfilePhoto: boolean }>({
        query: SET_MY_PHOTO,
        variables: { fileId: fileId() },
        token: tokenA,
      });

      expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.FILE_NOT_FOUND);
      expect(res.data).toBeNull();
      expect(await stored()).toEqual(before);
    });
  });

  describe.each(Object.keys(KINDS) as Kind[])('set %s photo', (kind) => {
    const { query, notFound } = KINDS[kind];
    let a: Person;
    let b: Person;

    /** A person of the institute with a profile of this kind and a picture already set. */
    const addPerson = (inst: TestInstitute) =>
      asAdmin(async (tx): Promise<Person> => {
        const tenantId = inst.tenantId;
        const suffix = randomUUID().slice(0, 8);
        const [user] = await tx
          .insert(users)
          .values({
            email: `photo_fid_${suffix}@test.local`,
            username: `photo_fid_${suffix}`,
            passwordHash: 'not-a-real-hash',
            ...BY,
          })
          .returning({ id: users.id });
        const [photo] = await tx
          .insert(files)
          .values({
            tenantId,
            subjectUserId: user.id,
            visibility: 'PRIVATE',
            purpose: 'PROFILE_PHOTO',
            objectKey: `users/${user.id}/profile-photo/${randomUUID()}.jpg`,
            originalName: 'old.jpg',
            contentType: 'image/jpeg',
            sizeBytes: 2048,
            status: 'READY',
            uploadedBy: inst.userId,
            createdBy: inst.userId,
            updatedBy: inst.userId,
          })
          .returning({ id: files.id });
        await tx
          .insert(userProfiles)
          .values({ userId: user.id, firstName: { en: `Person ${suffix}` }, ...BY });
        await tx.insert(tenantUserProfiles).values({
          tenantId,
          userId: user.id,
          firstName: { en: `Person ${suffix}` },
          profileImageFileId: photo.id,
          ...BY,
        });
        const [membership] = await tx
          .insert(memberships)
          .values({ userId: user.id, roleId: inst.roleId, tenantId, abilities: [], ...BY })
          .returning({ id: memberships.id });
        const profile = { tenantId, userId: user.id, membershipId: membership.id, ...BY };
        const [row] =
          kind === 'student'
            ? await tx
                .insert(studentProfiles)
                .values({
                  ...profile,
                  admissionNumber: `ADM-${suffix}`,
                  admissionDate: '2026-04-01',
                  admissionType: AdmissionType.NEW,
                })
                .returning({ id: studentProfiles.id })
            : kind === 'staff'
              ? await tx
                  .insert(staffProfiles)
                  .values({
                    ...profile,
                    employeeId: `EMP-${suffix}`,
                    designation: 'Teacher',
                    dateOfJoining: '2025-06-01',
                  })
                  .returning({ id: staffProfiles.id })
              : await tx
                  .insert(guardianProfiles)
                  .values(profile)
                  .returning({ id: guardianProfiles.id });
        return { userId: user.id, profileId: row.id, photoId: photo.id };
      });

    /** Files, account profiles and institute copies of everyone involved, in both institutes. */
    const snapshot = () =>
      asAdmin(async (tx) => {
        const tenants = [instA.tenantId, instB.tenantId];
        const people = [a.userId, b.userId, instA.userId, instB.userId];
        return {
          files: await tx
            .select()
            .from(files)
            .where(
              or(
                inArray(files.tenantId, tenants),
                inArray(files.subjectUserId, people),
                inArray(files.uploadedBy, [instA.userId, instB.userId]),
              ),
            )
            .orderBy(asc(files.id)),
          accounts: await tx
            .select()
            .from(userProfiles)
            .where(inArray(userProfiles.userId, people))
            .orderBy(asc(userProfiles.id)),
          copies: await tx
            .select()
            .from(tenantUserProfiles)
            .where(
              or(
                inArray(tenantUserProfiles.tenantId, tenants),
                inArray(tenantUserProfiles.userId, people),
              ),
            )
            .orderBy(asc(tenantUserProfiles.id)),
        };
      });

    const refusesAndWritesNothing = async (
      variables: { id: string; fileId: string | null },
      code: string,
    ) => {
      const before = await snapshot();
      const emit = vi.spyOn(EventBusService.prototype, 'emit');

      const res = await request({ query, variables, token: tokenA });

      expect(res.errors?.[0]?.extensions?.code).toBe(code);
      expect(res.data).toBeNull();
      expect(await snapshot()).toEqual(before);
      expect(emit.mock.calls.map(([pattern]) => pattern)).toEqual([]);
    };

    beforeAll(async () => {
      a = await addPerson(instA);
      b = await addPerson(instB);
      foreign.push(b.profileId, b.photoId);
      otherPeople.add(b.userId);
    });

    it(`should refuse a ${kind} of another institute and keep the picture it holds`, async () => {
      await refusesAndWritesNothing({ id: b.profileId, fileId: null }, notFound);
    });

    it(`should refuse a ${kind} of another institute with the caller's upload of that person`, async () => {
      const fileId = await pendingPhoto(b.userId, instA.userId);
      await refusesAndWritesNothing({ id: b.profileId, fileId }, notFound);
    });

    it.each([
      [
        'a picture of a person of another institute uploaded there',
        () => pendingPhoto(b.userId, instB.userId),
      ],
      [
        'a picture of its own person uploaded by another institute',
        () => pendingPhoto(a.userId, instB.userId),
      ],
      [
        'a picture of a person of another institute uploaded by the caller',
        () => pendingPhoto(b.userId, instA.userId),
      ],
      ['the picture another institute holds', () => Promise.resolve(b.photoId)],
    ])(`should refuse %s for its own ${kind} and change nothing`, async (_label, file) => {
      await refusesAndWritesNothing(
        { id: a.profileId, fileId: await file() },
        ErrorCode.FILE_NOT_FOUND,
      );
    });

    it(`should set the picture of its own ${kind} from its own upload`, async () => {
      const fileId = await pendingPhoto(a.userId, instA.userId);

      const res = await request({
        query,
        variables: { id: a.profileId, fileId },
        token: tokenA,
      });

      expect(res.errors).toBeUndefined();
      const stored = await asAdmin(async (tx) => ({
        copy: await tx
          .select({ fileId: tenantUserProfiles.profileImageFileId })
          .from(tenantUserProfiles)
          .where(eq(tenantUserProfiles.userId, a.userId)),
        file: await tx
          .select({ tenantId: files.tenantId, status: files.status })
          .from(files)
          .where(eq(files.id, fileId)),
      }));
      expect(stored).toEqual({
        copy: [{ fileId }],
        file: [{ tenantId: instA.tenantId, status: 'READY' }],
      });
    });
  });
});
