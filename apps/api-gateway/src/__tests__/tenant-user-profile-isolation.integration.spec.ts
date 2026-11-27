/**
 * ROV-292: a mobile number is not a person. Nothing links accounts across institutes by a typed
 * number, and each institute keeps its own copy of a person's name, demographics and picture
 * (`tenant_user_profiles`), which no other institute can read or change.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DefaultRoles, ErrorCode, Gender } from '@roviq/common-types';
import {
  academicYears,
  type DrizzleDB,
  files,
  guardianProfiles,
  memberships,
  mkAdminCtx,
  mkInstituteCtx,
  phoneNumbers,
  roles,
  SYSTEM_USER_ID,
  sections,
  standards,
  studentGuardianLinks,
  studentProfiles,
  tenantUserProfiles,
  userProfiles,
  users,
  withAdmin,
  withTenant,
} from '@roviq/database';
import type { EventBusService } from '@roviq/event-bus';
import { FakeStorageClient, StorageClient } from '@roviq/storage';
import {
  createInstituteToken,
  createIntegrationApp,
  createMock,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
  signedInAs,
  type TestInstitute,
} from '@roviq/testing/integration';
import { and, eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app/app.module';
import { IdentityService } from '../auth/identity.service';
import { EicarFileScanner } from '../files/scan/eicar-file-scanner';
import { FileScanner } from '../files/scan/file-scanner';
import { createStudentAdmissionActivities } from '../institute/admission/workflows/student-admission.activities';
import { createBulkStudentImportActivities } from '../institute/student/workflows/bulk-student-import.activities';
import type { ImportFileStore } from '../institute/student/workflows/bulk-student-import.types';
import { ProfileService } from '../institute/user/profile.service';

const ORIGIN = 'test:tenant-user-profile-isolation';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };

const CREATE_STUDENT = `mutation ($input: CreateStudentInput!) {
  createStudent(input: $input) { id userId firstName lastName gender religion }
}`;
const CREATE_GUARDIAN = `mutation ($input: CreateGuardianInput!) {
  createGuardian(input: $input) { id userId firstName lastName gender primaryPhone linkedStudentCount }
}`;
const CREATE_STAFF = `mutation ($input: CreateStaffInput!) {
  createStaffMember(input: $input) { id userId firstName lastName gender }
}`;
const UPDATE_STUDENT = `mutation ($id: ID!, $input: UpdateStudentInput!) {
  updateStudent(id: $id, input: $input) { id firstName version }
}`;
const UPDATE_GUARDIAN = `mutation ($id: ID!, $input: UpdateGuardianInput!) {
  updateGuardian(id: $id, input: $input) { id firstName version }
}`;
const GET_STUDENT = `query ($id: ID!) { getStudent(id: $id) { id firstName gender version } }`;
const SET_STUDENT_PHOTO = `mutation ($id: ID!, $fileId: ID) {
  setStudentPhoto(studentProfileId: $id, fileId: $fileId)
}`;
const SET_STAFF_PHOTO = `mutation ($id: ID!, $fileId: ID) {
  setStaffPhoto(staffProfileId: $id, fileId: $fileId)
}`;
const SET_GUARDIAN_PHOTO = `mutation ($id: ID!, $fileId: ID) {
  setGuardianPhoto(guardianProfileId: $id, fileId: $fileId)
}`;
const DOWNLOAD_URL = `mutation ($fileId: ID!) { fileDownloadUrl(fileId: $fileId) }`;

interface StudentNode {
  id: string;
  userId: string;
  firstName: Record<string, string>;
  lastName: Record<string, string> | null;
  gender: string | null;
  religion: string | null;
}
interface GuardianNode {
  id: string;
  userId: string;
  firstName: Record<string, string>;
  lastName: Record<string, string> | null;
  gender: string | null;
  primaryPhone: string | null;
  linkedStudentCount: number;
}
interface StaffNode {
  id: string;
  userId: string;
  firstName: Record<string, string>;
  lastName: Record<string, string> | null;
  gender: string | null;
}

interface Institute {
  base: TestInstitute;
  token: string;
  academicYearId: string;
  standardId: string;
  sectionId: string;
  studentRoleId: string;
  parentRoleId: string;
}

let phoneCounter = 0;
/** A fresh 10-digit mobile per call, so runs never collide. */
function mobile(): string {
  phoneCounter += 1;
  return `9${String(Date.now() % 1e7).padStart(7, '0')}${String(phoneCounter).padStart(2, '0')}`;
}

function codeOf(res: { errors?: readonly { extensions?: Record<string, unknown> }[] }) {
  return res.errors?.[0]?.extensions?.code;
}

async function setUpInstitute(db: DrizzleDB): Promise<Institute> {
  const base = await createTestInstitute(db);
  const token = createInstituteToken({
    sub: base.userId,
    tenantId: base.tenantId,
    membershipId: base.membershipId,
    roleId: base.roleId,
  });
  return withAdmin(db, mkAdminCtx(ORIGIN), async (tx) => {
    const roleIds: Record<string, string> = {};
    for (const name of [DefaultRoles.Student, DefaultRoles.Parent, DefaultRoles.Teacher]) {
      const [role] = await tx
        .insert(roles)
        .values({
          name: { en: name },
          scope: 'institute',
          tenantId: base.tenantId,
          abilities: [],
          isDefault: false,
          isSystem: false,
          ...BY,
        })
        .returning({ id: roles.id });
      roleIds[name] = role.id;
    }
    const [year] = await tx
      .insert(academicYears)
      .values({
        tenantId: base.tenantId,
        label: '2026-27',
        startDate: '2026-04-01',
        endDate: '2027-03-31',
        isActive: true,
        ...BY,
      })
      .returning({ id: academicYears.id });
    const [std] = await tx
      .insert(standards)
      .values({
        tenantId: base.tenantId,
        academicYearId: year.id,
        name: { en: 'Class 5' },
        numericOrder: 5,
        level: 'PRIMARY',
        ...BY,
      })
      .returning({ id: standards.id });
    const [sec] = await tx
      .insert(sections)
      .values({
        tenantId: base.tenantId,
        standardId: std.id,
        academicYearId: year.id,
        name: { en: 'A' },
        displayLabel: 'Class 5-A',
        capacity: 40,
        ...BY,
      })
      .returning({ id: sections.id });
    const studentRoleId = roleIds[DefaultRoles.Student];
    const parentRoleId = roleIds[DefaultRoles.Parent];
    assert(studentRoleId && parentRoleId);
    return {
      base,
      token,
      academicYearId: year.id,
      standardId: std.id,
      sectionId: sec.id,
      studentRoleId,
      parentRoleId,
    };
  });
}

describe('Per-institute profiles and phone numbers (integration)', () => {
  let app: IntegrationAppResult;
  let identity: IdentityService;
  let storage: FakeStorageClient;
  let a: Institute;
  let b: Institute;

  const gql = <T>(query: string, variables: Record<string, unknown>, inst: Institute) =>
    gqlRequest<T>(app.httpServer, { query, variables, token: inst.token });

  async function createStudent(inst: Institute, extra: Record<string, unknown> = {}) {
    return gql<{ createStudent: StudentNode }>(
      CREATE_STUDENT,
      {
        input: {
          firstName: { en: 'Aarav' },
          lastName: { en: 'Mehta' },
          gender: Gender.MALE,
          academicYearId: inst.academicYearId,
          standardId: inst.standardId,
          sectionId: inst.sectionId,
          ...extra,
        },
      },
      inst,
    );
  }

  async function createGuardian(inst: Institute, extra: Record<string, unknown> = {}) {
    return gql<{ createGuardian: GuardianNode }>(
      CREATE_GUARDIAN,
      { input: { firstName: { en: 'Sunita' }, lastName: { en: 'Rao' }, ...extra } },
      inst,
    );
  }

  async function createStaff(inst: Institute, extra: Record<string, unknown> = {}) {
    return gql<{ createStaffMember: StaffNode }>(
      CREATE_STAFF,
      { input: { firstName: { en: 'Kiran' }, lastName: { en: 'Das' }, ...extra } },
      inst,
    );
  }

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(app.db, mkAdminCtx(ORIGIN), fn);

  /** Every institute copy the user has, as tenant → first name. */
  async function copiesOf(userId: string) {
    const rows = await asAdmin((tx) =>
      tx
        .select({
          tenantId: tenantUserProfiles.tenantId,
          firstName: tenantUserProfiles.firstName,
          gender: tenantUserProfiles.gender,
          religion: tenantUserProfiles.religion,
          profileImageFileId: tenantUserProfiles.profileImageFileId,
        })
        .from(tenantUserProfiles)
        .where(eq(tenantUserProfiles.userId, userId)),
    );
    return new Map(rows.map(({ tenantId, ...rest }) => [tenantId, rest]));
  }

  async function membershipsIn(userId: string, tenantId: string) {
    return asAdmin((tx) =>
      tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId))),
    );
  }

  async function holdersOf(number: string) {
    const rows = await asAdmin((tx) =>
      tx
        .select({ userId: phoneNumbers.userId, isVerified: phoneNumbers.isVerified })
        .from(phoneNumbers)
        .where(and(eq(phoneNumbers.countryCode, '+91'), eq(phoneNumbers.number, number))),
    );
    return rows;
  }

  beforeAll(async () => {
    storage = new FakeStorageClient();
    app = await createIntegrationApp({
      modules: [AppModule],
      overrides: [
        { provide: StorageClient, useValue: storage },
        { provide: FileScanner, useValue: new EicarFileScanner() },
      ],
    });
    identity = app.app.get(IdentityService);
    a = await setUpInstitute(app.db);
    b = await setUpInstitute(app.db);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('a number typed in institute B that belongs to a user of institute A', () => {
    let number: string;
    let ownerId: string;

    beforeAll(async () => {
      number = mobile();
      const owner = await createStudent(a, { phone: number, religion: 'Jain' });
      expect(owner.errors).toBeUndefined();
      assert(owner.data);
      ownerId = owner.data.createStudent.userId;
    });

    it('creates a new student, guardian and staff member, each its own user', async () => {
      const student = await createStudent(b, { phone: number });
      const guardian = await createGuardian(b, { phone: number });
      const staff = await createStaff(b, { phone: number });

      expect([student.errors, guardian.errors, staff.errors]).toEqual([
        undefined,
        undefined,
        undefined,
      ]);
      assert(student.data && guardian.data && staff.data);
      const userIds = [
        student.data.createStudent.userId,
        guardian.data.createGuardian.userId,
        staff.data.createStaffMember.userId,
      ];
      expect(new Set([ownerId, ...userIds]).size).toBe(4);
      expect(await membershipsIn(ownerId, b.base.tenantId)).toEqual([]);
      expect((await copiesOf(ownerId)).has(b.base.tenantId)).toBe(false);
      for (const userId of userIds) {
        expect([...(await copiesOf(userId)).keys()]).toEqual([b.base.tenantId]);
      }
    });

    it('answers a student create the same way for a new number and this one, with nothing of A', async () => {
      const fresh = await createStudent(b, { phone: mobile() });
      const existing = await createStudent(b, { phone: number });

      expect(existing.errors).toBeUndefined();
      assert(fresh.data && existing.data);
      const { id: _f, userId: _fu, ...freshShape } = fresh.data.createStudent;
      const { id: _e, userId: _eu, ...existingShape } = existing.data.createStudent;
      expect(existingShape).toEqual(freshShape);
      expect(existingShape.religion).toBeNull();
    });

    it('answers a staff create the same way for a new number and this one', async () => {
      const fresh = await createStaff(b, { phone: mobile() });
      const existing = await createStaff(b, { phone: number });

      expect(existing.errors).toBeUndefined();
      assert(fresh.data && existing.data);
      const { id: _f, userId: _fu, ...freshShape } = fresh.data.createStaffMember;
      const { id: _e, userId: _eu, ...existingShape } = existing.data.createStaffMember;
      expect(existingShape).toEqual(freshShape);
    });

    it('answers a guardian create the same way, and keeps the typed number on the new guardian', async () => {
      const freshNumber = mobile();
      const fresh = await createGuardian(b, { phone: freshNumber });
      const existing = await createGuardian(b, { phone: number });

      expect(existing.errors).toBeUndefined();
      assert(fresh.data && existing.data);
      const { id: _f, userId: _fu, ...freshShape } = fresh.data.createGuardian;
      const { id: _e, userId: _eu, ...existingShape } = existing.data.createGuardian;
      expect(existingShape).toEqual({ ...freshShape, primaryPhone: number });
      expect(existingShape.primaryPhone).toBe(number);
      expect((await holdersOf(number)).map((h) => h.userId)).toContain(
        existing.data.createGuardian.userId,
      );
      expect((await holdersOf(number)).every((h) => !h.isVerified)).toBe(true);
    });
  });

  describe('a number that a guardian of the same institute already uses', () => {
    it('still creates a separate guardian from the form, with the typed name and number', async () => {
      const number = mobile();
      const first = await createGuardian(a, { phone: number });
      assert(first.data);

      const second = await createGuardian(a, { phone: number, firstName: { en: 'Someone Else' } });

      assert(second.data);
      expect(second.data.createGuardian.userId).not.toBe(first.data.createGuardian.userId);
      expect(second.data.createGuardian.firstName).toEqual({ en: 'Someone Else' });
      expect(second.data.createGuardian.primaryPhone).toBe(number);
    });

    describe('in the admission workflow', () => {
      async function admitWithParentPhone(parentPhone: string) {
        const activities = createStudentAdmissionActivities(
          app.db,
          createMock<EventBusService>(),
          identity,
        );
        const seed = randomUUID();
        const formData = {
          studentName: 'Admitted Child',
          parentName: 'Typed Parent',
          parentPhone,
          parentRelation: 'FATHER',
        };
        const tenantId = a.base.tenantId;
        const student = await activities.admitStudent({
          tenantId,
          actorId: a.base.userId,
          seed,
          academicYearId: a.academicYearId,
          standardId: a.standardId,
          sectionId: null,
          formData,
          isRte: false,
        });
        const { studentProfileId } = student;
        await activities.linkGuardians(tenantId, studentProfileId, formData, a.base.userId, seed);
        const [link] = await asAdmin((tx) =>
          tx
            .select({ guardianUserId: guardianProfiles.userId })
            .from(studentGuardianLinks)
            .innerJoin(
              guardianProfiles,
              eq(guardianProfiles.id, studentGuardianLinks.guardianProfileId),
            )
            .where(eq(studentGuardianLinks.studentProfileId, studentProfileId)),
        );
        assert(link);
        return link.guardianUserId;
      }

      it('does not link a guardian who typed the number into their own profile', async () => {
        const claimed = mobile();
        const claimer = await createGuardian(a, { phone: mobile() });
        assert(claimer.data);
        const claimerUserId = claimer.data.createGuardian.userId;
        await app.app
          .get(ProfileService)
          .updateMyProfile(signedInAs(claimerUserId), { phone: claimed });
        expect(await holdersOf(claimed)).toEqual([{ userId: claimerUserId, isVerified: false }]);

        expect(await admitWithParentPhone(claimed)).not.toBe(claimerUserId);
      });

      it('does not link anyone when two active guardians have the number', async () => {
        const shared = mobile();
        const first = await createGuardian(a, { phone: shared });
        const second = await createGuardian(a, { phone: shared });
        assert(first.data && second.data);

        expect([first.data.createGuardian.userId, second.data.createGuardian.userId]).not.toContain(
          await admitWithParentPhone(shared),
        );
      });

      it('links an active guardian of the institute who uses the number', async () => {
        const number = mobile();
        const guardian = await createGuardian(a, { phone: number });
        assert(guardian.data);

        expect(await admitWithParentPhone(number)).toBe(guardian.data.createGuardian.userId);
      });

      it('does not link a suspended guardian, a student or a guardian of another institute', async () => {
        const suspendedNumber = mobile();
        const suspended = await createGuardian(a, { phone: suspendedNumber });
        assert(suspended.data);
        const suspendedId = suspended.data.createGuardian.userId;
        await asAdmin((tx) =>
          tx
            .update(memberships)
            .set({ status: 'SUSPENDED' })
            .where(eq(memberships.userId, suspendedId)),
        );
        const studentNumber = mobile();
        const student = await createStudent(a, { phone: studentNumber });
        const otherNumber = mobile();
        const other = await createGuardian(b, { phone: otherNumber });
        assert(student.data && other.data);

        const linked = [
          await admitWithParentPhone(suspendedNumber),
          await admitWithParentPhone(studentNumber),
          await admitWithParentPhone(otherNumber),
        ];

        expect(linked).not.toContain(suspendedId);
        expect(linked).not.toContain(student.data.createStudent.userId);
        expect(linked).not.toContain(other.data.createGuardian.userId);
        expect(await membershipsIn(other.data.createGuardian.userId, a.base.tenantId)).toEqual([]);
      });
    });
  });

  describe('the institute that created an account (ROV-372)', () => {
    const originOf = async (userId: string) => {
      const [row] = await asAdmin((tx) =>
        tx.select({ originTenantId: users.originTenantId }).from(users).where(eq(users.id, userId)),
      );
      return row?.originTenantId;
    };

    it('is recorded for a student, a guardian and a staff member the institute creates', async () => {
      const student = await createStudent(b);
      const guardian = await createGuardian(b, { phone: mobile() });
      const staff = await createStaff(b, { phone: mobile() });
      assert(student.data && guardian.data && staff.data);

      for (const userId of [
        student.data.createStudent.userId,
        guardian.data.createGuardian.userId,
        staff.data.createStaffMember.userId,
      ]) {
        expect(await originOf(userId)).toBe(b.base.tenantId);
      }
    });

    it("refuses institute A a membership for institute B's person, and writes nothing", async () => {
      const guardian = await createGuardian(b, { phone: mobile() });
      assert(guardian.data);
      const personOfB = guardian.data.createGuardian.userId;

      await expect(
        identity.createMembership({
          userId: personOfB,
          scope: 'institute',
          tenantId: a.base.tenantId,
          roleId: a.parentRoleId,
          actorId: a.base.userId,
        }),
      ).rejects.toThrow(/membership/);

      expect(await membershipsIn(personOfB, a.base.tenantId)).toEqual([]);
      expect((await copiesOf(personOfB)).has(a.base.tenantId)).toBe(false);
    });

    it('refuses an institute a membership for an account no institute created', async () => {
      const handle = `platform-made-${randomUUID().slice(0, 8)}`;
      const { userId } = await identity.createUser({
        email: `${handle}@test.local`,
        username: handle,
        actorId: SYSTEM_USER_ID,
        originTenantId: null,
      });

      await expect(
        identity.createMembership({
          userId,
          scope: 'institute',
          tenantId: a.base.tenantId,
          roleId: a.parentRoleId,
          actorId: a.base.userId,
        }),
      ).rejects.toThrow(/membership/);
      expect(await membershipsIn(userId, a.base.tenantId)).toEqual([]);
    });

    it('adds a first-admin membership only for the user the institute names', async () => {
      const guardian = await createGuardian(b, { phone: mobile() });
      assert(guardian.data);
      const notTheFirstAdmin = guardian.data.createGuardian.userId;

      const refused = await identity.createFirstAdminMembership({
        userId: notTheFirstAdmin,
        tenantId: a.base.tenantId,
        roleId: a.parentRoleId,
        actorId: SYSTEM_USER_ID,
      });

      expect(refused).toBeNull();
      expect(await membershipsIn(notTheFirstAdmin, a.base.tenantId)).toEqual([]);
    });
  });

  describe('a person who belongs to two institutes', () => {
    let personId: string;
    const studentProfileIn: Record<string, string> = {};
    const guardianProfileIn: Record<string, string> = {};
    const studentMembershipIn: Record<string, string> = {};

    beforeAll(async () => {
      const handle = `shared-${randomUUID().slice(0, 8)}`;
      ({ userId: personId } = await identity.createUser({
        email: `${handle}@test.local`,
        username: handle,
        actorId: SYSTEM_USER_ID,
        originTenantId: null,
      }));
      await identity.ensureUserProfile(personId, { firstName: 'Account' }, SYSTEM_USER_ID);
      for (const inst of [a, b]) {
        // Only the platform role can add an existing account to an institute; once the person
        // is an active member, the institute itself adds the second role.
        const [student] = await asAdmin((tx) =>
          tx
            .insert(memberships)
            .values({
              userId: personId,
              tenantId: inst.base.tenantId,
              roleId: inst.studentRoleId,
              ...BY,
            })
            .returning({ membershipId: memberships.id }),
        );
        const parent = await identity.createMembership({
          userId: personId,
          scope: 'institute',
          tenantId: inst.base.tenantId,
          roleId: inst.parentRoleId,
          actorId: SYSTEM_USER_ID,
        });
        await asAdmin(async (tx) => {
          const [sp] = await tx
            .insert(studentProfiles)
            .values({
              tenantId: inst.base.tenantId,
              userId: personId,
              membershipId: student.membershipId,
              admissionNumber: `ROV292-${randomUUID().slice(0, 8)}`,
              admissionDate: '2026-04-01',
              ...BY,
            })
            .returning({ id: studentProfiles.id });
          const [gp] = await tx
            .insert(guardianProfiles)
            .values({
              tenantId: inst.base.tenantId,
              userId: personId,
              membershipId: parent.membershipId,
              ...BY,
            })
            .returning({ id: guardianProfiles.id });
          studentProfileIn[inst.base.tenantId] = sp.id;
          guardianProfileIn[inst.base.tenantId] = gp.id;
          studentMembershipIn[inst.base.tenantId] = student.membershipId;
        });
      }
      // What institute A records about the person differs from the account.
      await withTenant(app.db, mkInstituteCtx(a.base.tenantId, ORIGIN), (tx) =>
        tx
          .update(tenantUserProfiles)
          .set({ firstName: { en: 'Recorded by A' }, gender: Gender.FEMALE, religion: 'Sikh' })
          .where(eq(tenantUserProfiles.userId, personId)),
      );
    });

    const aCopy = { firstName: { en: 'Recorded by A' }, gender: Gender.FEMALE, religion: 'Sikh' };

    it('got a copy of the account name in each institute when the membership was created', async () => {
      const copies = await copiesOf(personId);

      expect([...copies.keys()].sort()).toEqual([a.base.tenantId, b.base.tenantId].sort());
      expect(copies.get(b.base.tenantId)).toEqual({
        firstName: { en: 'Account' },
        gender: null,
        religion: null,
        profileImageFileId: null,
      });
    });

    describe('as roviq_app with institute B as the tenant', () => {
      const asB = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
        withTenant(app.db, mkInstituteCtx(b.base.tenantId, ORIGIN), fn);

      it("reads only B's copy, never A's", async () => {
        const rows = await asB((tx) =>
          tx
            .select({ tenantId: tenantUserProfiles.tenantId })
            .from(tenantUserProfiles)
            .where(eq(tenantUserProfiles.userId, personId)),
        );
        const ofA = await asB((tx) =>
          tx
            .select({ id: tenantUserProfiles.id })
            .from(tenantUserProfiles)
            .where(eq(tenantUserProfiles.tenantId, a.base.tenantId)),
        );

        expect(rows).toEqual([{ tenantId: b.base.tenantId }]);
        expect(ofA).toEqual([]);
      });

      it("changes 0 rows of A's copy", async () => {
        const updated = await asB((tx) =>
          tx
            .update(tenantUserProfiles)
            .set({ firstName: { en: 'Overwritten' } })
            .where(eq(tenantUserProfiles.tenantId, a.base.tenantId))
            .returning({ id: tenantUserProfiles.id }),
        );

        expect(updated).toEqual([]);
        expect((await copiesOf(personId)).get(a.base.tenantId)).toMatchObject(aCopy);
      });

      it('cannot insert a copy for institute A', async () => {
        await expect(
          asB((tx) =>
            tx.insert(tenantUserProfiles).values({
              tenantId: a.base.tenantId,
              userId: a.base.userId,
              firstName: { en: 'Planted' },
              ...BY,
            }),
          ),
        ).rejects.toMatchObject({
          cause: {
            message: 'new row violates row-level security policy for table "tenant_user_profiles"',
          },
        });
      });
    });

    it("B's student update changes B's copy only, not A's copy or the account", async () => {
      const id = studentProfileIn[b.base.tenantId];
      const current = await gql<{ getStudent: { version: number } }>(GET_STUDENT, { id }, b);
      assert(current.data);

      const res = await gql<{ updateStudent: { firstName: Record<string, string> } }>(
        UPDATE_STUDENT,
        {
          id,
          input: { firstName: { en: 'Renamed by B' }, version: current.data.getStudent.version },
        },
        b,
      );

      expect(res.errors).toBeUndefined();
      expect(res.data?.updateStudent.firstName).toEqual({ en: 'Renamed by B' });
      const copies = await copiesOf(personId);
      expect(copies.get(a.base.tenantId)).toMatchObject(aCopy);
      expect(copies.get(b.base.tenantId)?.firstName).toEqual({ en: 'Renamed by B' });
      const [account] = await asAdmin((tx) =>
        tx
          .select({ firstName: userProfiles.firstName })
          .from(userProfiles)
          .where(eq(userProfiles.userId, personId)),
      );
      expect(account).toEqual({ firstName: { en: 'Account' } });
    });

    it("B's guardian update changes B's copy only", async () => {
      const id = guardianProfileIn[b.base.tenantId];

      const res = await gql<{ updateGuardian: { firstName: Record<string, string> } }>(
        UPDATE_GUARDIAN,
        { id, input: { firstName: { en: 'Guardian by B' }, version: 1 } },
        b,
      );

      expect(res.errors).toBeUndefined();
      expect(res.data?.updateGuardian.firstName).toEqual({ en: 'Guardian by B' });
      expect((await copiesOf(personId)).get(a.base.tenantId)).toMatchObject(aCopy);
    });

    it("shows the person their details as each institute records them, never the other's", async () => {
      const MY_PROFILE = `query { myProfile { ... on MyStudentProfile { userProfile { firstName gender } } } }`;
      const asPersonIn = (inst: Institute) =>
        gqlRequest<{ myProfile: { userProfile: { firstName: unknown; gender: string | null } } }>(
          app.httpServer,
          {
            query: MY_PROFILE,
            token: createInstituteToken({
              sub: personId,
              tenantId: inst.base.tenantId,
              membershipId: studentMembershipIn[inst.base.tenantId],
              roleId: inst.studentRoleId,
            }),
          },
        );

      const inA = await asPersonIn(a);
      const inB = await asPersonIn(b);

      expect(inA.errors).toBeUndefined();
      expect(inA.data?.myProfile.userProfile).toEqual({
        firstName: aCopy.firstName,
        gender: aCopy.gender,
      });
      expect(inB.data?.myProfile.userProfile.gender).toBeNull();
      expect(inB.data?.myProfile.userProfile.firstName).not.toEqual(aCopy.firstName);
    });

    it("B shows its own copy of the student, never A's", async () => {
      const res = await gql<{ getStudent: { firstName: Record<string, string>; gender: string } }>(
        GET_STUDENT,
        { id: studentProfileIn[b.base.tenantId] },
        b,
      );

      expect(res.errors).toBeUndefined();
      expect(res.data?.getStudent.firstName).not.toEqual(aCopy.firstName);
      expect(res.data?.getStudent.gender).toBeNull();
    });

    it("refuses B's update of A's student or guardian by id, and A's copy stays", async () => {
      const student = await gql(
        UPDATE_STUDENT,
        { id: studentProfileIn[a.base.tenantId], input: { firstName: { en: 'X' }, version: 1 } },
        b,
      );
      const guardian = await gql(
        UPDATE_GUARDIAN,
        { id: guardianProfileIn[a.base.tenantId], input: { firstName: { en: 'X' }, version: 1 } },
        b,
      );

      expect(codeOf(student)).toBe(ErrorCode.STUDENT_NOT_FOUND);
      expect(codeOf(guardian)).toBe(ErrorCode.GUARDIAN_NOT_FOUND);
      expect((await copiesOf(personId)).get(a.base.tenantId)).toMatchObject(aCopy);
    });

    describe("A's picture of the person", () => {
      let fileId: string;

      /** An upload as `requestFileUpload` leaves it: a PENDING row and the bytes in storage. */
      async function pendingPhoto(uploader: Institute): Promise<string> {
        const bytes = await sharp({
          create: { width: 300, height: 200, channels: 3, background: { r: 10, g: 90, b: 160 } },
        })
          .jpeg()
          .toBuffer();
        const objectKey = `users/${personId}/profile-photo/${randomUUID()}.jpg`;
        await storage.put('private', `pending/${objectKey}`, bytes, {
          contentType: 'image/jpeg',
        });
        const [file] = await asAdmin((tx) =>
          tx
            .insert(files)
            .values({
              subjectUserId: personId,
              visibility: 'PRIVATE',
              purpose: 'PROFILE_PHOTO',
              objectKey,
              originalName: 'portrait.jpg',
              contentType: 'image/jpeg',
              sizeBytes: bytes.length,
              status: 'PENDING',
              uploadedBy: uploader.base.userId,
              createdBy: uploader.base.userId,
              updatedBy: uploader.base.userId,
            })
            .returning({ id: files.id }),
        );
        assert(file);
        return file.id;
      }

      beforeAll(async () => {
        fileId = await pendingPhoto(a);
        const set = await gql(
          SET_STUDENT_PHOTO,
          { id: studentProfileIn[a.base.tenantId], fileId },
          a,
        );
        expect(set.errors).toBeUndefined();
      });

      it("becomes A's file and A's copy only", async () => {
        const [row] = await asAdmin((tx) =>
          tx
            .select({ tenantId: files.tenantId, status: files.status })
            .from(files)
            .where(eq(files.id, fileId)),
        );
        const copies = await copiesOf(personId);

        expect(row).toEqual({ tenantId: a.base.tenantId, status: 'READY' });
        expect(copies.get(a.base.tenantId)?.profileImageFileId).toBe(fileId);
        expect(copies.get(b.base.tenantId)?.profileImageFileId).toBeNull();
        const [account] = await asAdmin((tx) =>
          tx
            .select({ fileId: userProfiles.profileImageFileId })
            .from(userProfiles)
            .where(eq(userProfiles.userId, personId)),
        );
        expect(account).toEqual({ fileId: null });
      });

      it('cannot be read by B, by row or by download link', async () => {
        const rows = await withTenant(app.db, mkInstituteCtx(b.base.tenantId, ORIGIN), (tx) =>
          tx.select({ id: files.id }).from(files).where(eq(files.id, fileId)),
        );
        const download = await gql(DOWNLOAD_URL, { fileId }, b);

        expect(rows).toEqual([]);
        expect(codeOf(download)).toBe(ErrorCode.FILE_NOT_FOUND);
      });

      it('cannot be set by B on its own profile of the person', async () => {
        const res = await gql(
          SET_STUDENT_PHOTO,
          { id: studentProfileIn[b.base.tenantId], fileId },
          b,
        );

        expect(codeOf(res)).toBe(ErrorCode.FILE_NOT_FOUND);
        expect((await copiesOf(personId)).get(b.base.tenantId)?.profileImageFileId).toBeNull();
      });

      it('is left alone when B removes its own picture of the person', async () => {
        const res = await gql(
          SET_STUDENT_PHOTO,
          { id: studentProfileIn[b.base.tenantId], fileId: null },
          b,
        );

        expect(res.errors).toBeUndefined();
        expect((await copiesOf(personId)).get(a.base.tenantId)?.profileImageFileId).toBe(fileId);
      });

      it("refuses B setting a picture on A's student, staff or guardian by id", async () => {
        const staff = await createStaff(a);
        assert(staff.data);

        const student = await gql(
          SET_STUDENT_PHOTO,
          { id: studentProfileIn[a.base.tenantId], fileId: null },
          b,
        );
        const guardian = await gql(
          SET_GUARDIAN_PHOTO,
          { id: guardianProfileIn[a.base.tenantId], fileId: null },
          b,
        );
        const staffRes = await gql(
          SET_STAFF_PHOTO,
          { id: staff.data.createStaffMember.id, fileId: null },
          b,
        );

        expect(codeOf(student)).toBe(ErrorCode.STUDENT_NOT_FOUND);
        expect(codeOf(guardian)).toBe(ErrorCode.GUARDIAN_NOT_FOUND);
        expect(codeOf(staffRes)).toBe(ErrorCode.STAFF_NOT_FOUND);
        expect((await copiesOf(personId)).get(a.base.tenantId)?.profileImageFileId).toBe(fileId);
      });
    });
  });

  describe('a staff member', () => {
    const UPDATE_STAFF = `mutation ($id: ID!, $input: UpdateStaffInput!) {
      updateStaffMember(id: $id, input: $input) { id firstName lastName dateOfBirth }
    }`;

    it("is renamed in the institute's copy only, and not by another institute", async () => {
      const staff = await createStaff(a, { lastName: { en: 'Das' } });
      assert(staff.data);
      const { id, userId } = staff.data.createStaffMember;
      const input = {
        firstName: { en: 'Kiranjit' },
        lastName: null,
        dateOfBirth: '1988-02-03',
        version: 1,
      };

      const refused = await gql(UPDATE_STAFF, { id, input }, b);
      const updated = await gql<{ updateStaffMember: Record<string, unknown> }>(
        UPDATE_STAFF,
        { id, input },
        a,
      );

      expect(codeOf(refused)).toBe(ErrorCode.STAFF_NOT_FOUND);
      expect(updated.data?.updateStaffMember).toEqual({
        id,
        firstName: { en: 'Kiranjit' },
        lastName: null,
        dateOfBirth: '1988-02-03',
      });
      const [account] = await asAdmin((tx) =>
        tx
          .select({ firstName: userProfiles.firstName, lastName: userProfiles.lastName })
          .from(userProfiles)
          .where(eq(userProfiles.userId, userId)),
      );
      expect(account).toEqual({ firstName: { en: 'Kiran' }, lastName: { en: 'Das' } });
    });
  });

  describe('name search on the people lists', () => {
    it('finds a student, a staff member and a guardian by the start of a name', async () => {
      const tag = `Zq${randomUUID().slice(0, 6)}`;
      const student = await createStudent(a, { firstName: { en: `${tag}student` } });
      const staff = await createStaff(a, { firstName: { en: `${tag}staff` } });
      const guardian = await createGuardian(a, { firstName: { en: `${tag}guardian` } });
      assert(student.data && staff.data && guardian.data);
      const search = tag.slice(0, 6);

      const students = await gql<{ listStudents: { edges: { node: { id: string } }[] } }>(
        `query ($filter: StudentFilterInput) { listStudents(filter: $filter) { edges { node { id } } } }`,
        { filter: { search } },
        a,
      );
      const staffList = await gql<{ listStaff: { id: string }[] }>(
        `query ($filter: ListStaffFilterInput) { listStaff(filter: $filter) { id } }`,
        { filter: { search } },
        a,
      );
      const guardians = await gql<{ listGuardians: { id: string }[] }>(
        `query ($filter: ListGuardiansFilterInput) { listGuardians(filter: $filter) { id } }`,
        { filter: { search } },
        a,
      );
      const inB = await gql<{ listStaff: { id: string }[] }>(
        `query ($filter: ListStaffFilterInput) { listStaff(filter: $filter) { id } }`,
        { filter: { search } },
        b,
      );

      expect(students.errors).toBeUndefined();
      expect(students.data?.listStudents.edges.map((e) => e.node.id)).toEqual([
        student.data.createStudent.id,
      ]);
      expect(staffList.data?.listStaff).toEqual([{ id: staff.data.createStaffMember.id }]);
      expect(guardians.data?.listGuardians).toEqual([{ id: guardian.data.createGuardian.id }]);
      expect(inB.data?.listStaff).toEqual([]);
    });
  });

  describe('bulk import', () => {
    it('creates two students for two rows (siblings) with the same phone', async () => {
      const number = mobile();
      const activities = createBulkStudentImportActivities(
        app.db,
        null,
        identity,
        createMock<ImportFileStore>(),
      );
      const row = (rowNumber: number, firstName: string) => ({
        rowNumber,
        firstName,
        lastName: 'Iyer',
        dateOfBirth: '2016-05-01',
        gender: Gender.FEMALE,
        phone: number,
      });

      const result = await activities.insertBatch(
        a.base.tenantId,
        a.academicYearId,
        a.standardId,
        a.sectionId,
        a.base.userId,
        [row(1, 'Ananya'), row(2, 'Diya')],
      );

      expect(result).toEqual({ created: 2, skipped: 0, errors: [] });
      const holders = await holdersOf(number);
      expect(new Set(holders.map((h) => h.userId)).size).toBe(2);
      const names = await asAdmin((tx) =>
        tx
          .select({ firstName: tenantUserProfiles.firstName })
          .from(tenantUserProfiles)
          .where(
            and(
              eq(tenantUserProfiles.tenantId, a.base.tenantId),
              inArray(
                tenantUserProfiles.userId,
                holders.map((h) => h.userId),
              ),
            ),
          ),
      );
      expect(names.map((n) => n.firstName.en).sort()).toEqual(['Ananya', 'Diya']);
    });
  });
});
