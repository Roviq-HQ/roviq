/**
 * ROV-382: a person's membership of an institute ends with their last profile there and
 * comes back when a profile is restored. Through GraphQL for the flows, and as the institute
 * database role for the rules PostgreSQL holds.
 */
import assert from 'node:assert';
import { createHash, randomUUID } from 'node:crypto';
import {
  type AbilityRule,
  AcademicStatus,
  AdmissionType,
  EmploymentType,
  SocialCategory,
} from '@roviq/common-types';
import {
  type DrizzleDB,
  guardianProfiles,
  memberships,
  mkAdminCtx,
  mkInstituteCtx,
  phoneNumbers,
  refreshTokens,
  roles,
  SYSTEM_USER_ID,
  staffProfiles,
  studentProfiles,
  tenantUserProfiles,
  userProfiles,
  users,
  withAdmin,
  withTenant,
} from '@roviq/database';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app/app.module';
import { IdentityRepository } from '../auth/repositories/identity.repository';
import { BotProfileRepository } from '../institute/bot/repositories/bot-profile.repository';
import { GuardianRepository } from '../institute/guardian/repositories/guardian.repository';
import { StaffRepository } from '../institute/staff/repositories/staff.repository';

const ORIGIN = 'test:membership-ends-with-last-profile';
const AUDIT = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
const FULL_CONTROL: AbilityRule[] = [{ action: 'manage', subject: 'all' }];
const READS_STAFF: AbilityRule[] = [{ action: 'read', subject: 'Staff' }];

type Kind = 'student' | 'staff' | 'guardian';
const OPERATIONS: Record<Kind, { remove: string; restore: string; trash: string; gone: string }> = {
  student: {
    remove: 'deleteStudent',
    restore: 'restoreStudent',
    trash: 'listDeletedStudents',
    gone: 'STUDENT_NOT_FOUND',
  },
  staff: {
    remove: 'deleteStaffMember',
    restore: 'restoreStaffMember',
    trash: 'listDeletedStaff',
    gone: 'STAFF_NOT_FOUND',
  },
  guardian: {
    remove: 'deleteGuardian',
    restore: 'restoreGuardian',
    trash: 'listDeletedGuardians',
    gone: 'GUARDIAN_NOT_FOUND',
  },
};

interface Person {
  userId: string;
  membershipId: string;
  roleId: string;
  name: string;
}

async function createPerson(
  db: DrizzleDB,
  tenantId: string,
  abilities: AbilityRule[] = READS_STAFF,
): Promise<Person> {
  const suffix = randomUUID().slice(0, 8);
  const name = `Person ${suffix}`;
  return withAdmin(db, mkAdminCtx(ORIGIN), async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email: `rov382_${suffix}@test.local`,
        username: `rov382_${suffix}`,
        passwordHash: 'not-a-real-hash',
        originTenantId: tenantId,
        ...AUDIT,
      })
      .returning({ id: users.id });
    await tx.insert(userProfiles).values({ userId: user.id, firstName: { en: name }, ...AUDIT });
    await tx.insert(phoneNumbers).values({
      userId: user.id,
      countryCode: '+91',
      number: `9${Math.floor(Math.random() * 1e9)
        .toString()
        .padStart(9, '0')}`,
      isPrimary: true,
      ...AUDIT,
    });
    await tx
      .insert(tenantUserProfiles)
      .values({ tenantId, userId: user.id, firstName: { en: name }, ...AUDIT });
    const [role] = await tx
      .insert(roles)
      .values({
        name: { en: `Role ${suffix}` },
        scope: 'institute',
        tenantId,
        abilities,
        isDefault: false,
        isSystem: false,
        ...AUDIT,
      })
      .returning({ id: roles.id });
    const [membership] = await tx
      .insert(memberships)
      .values({ userId: user.id, roleId: role.id, tenantId, abilities: [], ...AUDIT })
      .returning({ id: memberships.id });
    return { userId: user.id, membershipId: membership.id, roleId: role.id, name };
  });
}

async function createProfile(
  db: DrizzleDB,
  tenantId: string,
  kind: Kind,
  person: Person,
): Promise<string> {
  const member = { tenantId, userId: person.userId, membershipId: person.membershipId, ...AUDIT };
  return withAdmin(db, mkAdminCtx(ORIGIN), async (tx) => {
    if (kind === 'student') {
      const [row] = await tx
        .insert(studentProfiles)
        .values({
          ...member,
          admissionNumber: `ADM-${randomUUID().slice(0, 8)}`,
          admissionDate: '2025-04-01',
          admissionType: AdmissionType.NEW,
          academicStatus: AcademicStatus.ENROLLED,
          socialCategory: SocialCategory.GENERAL,
        })
        .returning({ id: studentProfiles.id });
      return row.id;
    }
    if (kind === 'staff') {
      const [row] = await tx
        .insert(staffProfiles)
        .values({ ...member, employeeId: `EMP-${randomUUID().slice(0, 8)}` })
        .returning({ id: staffProfiles.id });
      return row.id;
    }
    const [row] = await tx
      .insert(guardianProfiles)
      .values(member)
      .returning({ id: guardianProfiles.id });
    return row.id;
  });
}

async function openSession(db: DrizzleDB, tenantId: string, person: Person): Promise<string> {
  const [row] = await withAdmin(db, mkAdminCtx(ORIGIN), (tx) =>
    tx
      .insert(refreshTokens)
      .values({
        tenantId,
        userId: person.userId,
        membershipId: person.membershipId,
        membershipScope: 'institute',
        tokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
        expiresAt: new Date(Date.now() + 3_600_000),
        ...AUDIT,
      })
      .returning({ id: refreshTokens.id }),
  );
  return row.id;
}

describe('ROV-382 a membership ends with the last profile', () => {
  let result: IntegrationAppResult;
  let institute: TestInstitute;
  let adminToken: string;

  const gql = <T>(query: string, token: string, variables: Record<string, unknown> = {}) =>
    gqlRequest<T>(result.httpServer, { query, variables, token });
  const mutate = (field: string, id: string, token = adminToken) =>
    gql<Record<string, boolean>>(`mutation($id: ID!) { ${field}(id: $id) }`, token, { id });
  const codeOf = (response: { errors?: Array<{ extensions?: { code?: unknown } }> }) =>
    response.errors?.[0]?.extensions?.code;
  const tokenOf = (person: { userId: string; membershipId: string; roleId: string }) =>
    createInstituteToken({
      sub: person.userId,
      tenantId: institute.tenantId,
      membershipId: person.membershipId,
      roleId: person.roleId,
    });

  const membershipOf = async (person: Person) => {
    const [row] = await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .select({
          id: memberships.id,
          deletedAt: memberships.deletedAt,
          deletedBy: memberships.deletedBy,
        })
        .from(memberships)
        .where(eq(memberships.id, person.membershipId)),
    );
    return row;
  };

  /** How many of the person's account rows the institute's own database role can read. */
  const accountRowsReadableByInstitute = (person: Person, tenantId = institute.tenantId) =>
    withTenant(result.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const account = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, person.userId));
      const profile = await tx
        .select({ id: userProfiles.id })
        .from(userProfiles)
        .where(eq(userProfiles.userId, person.userId));
      const phones = await tx
        .select({ id: phoneNumbers.id })
        .from(phoneNumbers)
        .where(eq(phoneNumbers.userId, person.userId));
      return { users: account.length, userProfiles: profile.length, phoneNumbers: phones.length };
    });

  const sessionOf = async (id: string) => {
    const [row] = await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .select({ revokedAt: refreshTokens.revokedAt, revokedReason: refreshTokens.revokedReason })
        .from(refreshTokens)
        .where(eq(refreshTokens.id, id)),
    );
    return row;
  };

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    institute = await createTestInstitute(result.db);
    adminToken = tokenOf(institute);
  });

  afterAll(async () => {
    await result?.close();
  });

  describe.each(['student', 'staff', 'guardian'] as const)('%s', (kind) => {
    const op = OPERATIONS[kind];
    let person: Person;
    let profileId: string;
    let sessionId: string;

    beforeAll(async () => {
      person = await createPerson(result.db, institute.tenantId);
      profileId = await createProfile(result.db, institute.tenantId, kind, person);
      sessionId = await openSession(result.db, institute.tenantId, person);
    });

    it('lets the member in and lets the institute read their account while the profile exists', async () => {
      expect(await accountRowsReadableByInstitute(person)).toEqual({
        users: 1,
        userProfiles: 1,
        phoneNumbers: 1,
      });
      const listed = await gql('query { listStaff { id } }', tokenOf(person));
      expect(listed.errors).toBeUndefined();
    });

    it('ends the membership and its sessions when the only profile is deleted', async () => {
      const removed = await mutate(op.remove, profileId);
      expect(removed.errors).toBeUndefined();

      const membership = await membershipOf(person);
      expect(membership.deletedAt).toBeInstanceOf(Date);
      expect(membership.deletedBy).toBe(institute.userId);
      const session = await sessionOf(sessionId);
      expect(session.revokedAt).toBeInstanceOf(Date);
      expect(session.revokedReason).toBe('ADMIN_REVOKED');
    });

    it('refuses the former member: no new session, and nothing with a token issued before', async () => {
      await expect(openSession(result.db, institute.tenantId, person)).rejects.toMatchObject({
        cause: { message: expect.stringContaining('no active institute membership') },
      });
      const listed = await gql('query { listStaff { id } }', tokenOf(person));
      expect(codeOf(listed)).toBe('FORBIDDEN');
    });

    it('hides the account of the former member from the institute database role', async () => {
      expect(await accountRowsReadableByInstitute(person)).toEqual({
        users: 0,
        userProfiles: 0,
        phoneNumbers: 0,
      });
    });

    it('still names the person in the Deleted list', async () => {
      const trash = await gql<
        Record<string, Array<{ id: string; firstName: Record<string, string> }>>
      >(`query { ${op.trash} { id firstName } }`, adminToken);
      expect(trash.errors).toBeUndefined();
      assert(trash.data);
      const row = trash.data[op.trash].find((entry) => entry.id === profileId);
      expect(row?.firstName).toEqual({ en: person.name });
    });

    it('brings the same membership back when the profile is restored', async () => {
      const restored = await mutate(op.restore, profileId);
      expect(restored.errors).toBeUndefined();

      const membership = await membershipOf(person);
      expect(membership).toEqual({ id: person.membershipId, deletedAt: null, deletedBy: null });
      expect(await accountRowsReadableByInstitute(person)).toEqual({
        users: 1,
        userProfiles: 1,
        phoneNumbers: 1,
      });
      const listed = await gql('query { listStaff { id } }', tokenOf(person));
      expect(listed.errors).toBeUndefined();
      // The sessions ended with the membership stay ended; the person signs in again.
      expect((await sessionOf(sessionId)).revokedReason).toBe('ADMIN_REVOKED');
      await expect(openSession(result.db, institute.tenantId, person)).resolves.toEqual(
        expect.any(String),
      );
    });

    it('answers not found for a profile of another institute and ends nothing there', async () => {
      const other = await createTestInstitute(result.db);
      const otherToken = createInstituteToken({
        sub: other.userId,
        tenantId: other.tenantId,
        membershipId: other.membershipId,
        roleId: other.roleId,
      });
      const removed = await mutate(op.remove, profileId, otherToken);
      expect(codeOf(removed)).toBe(op.gone);
      expect((await membershipOf(person)).deletedAt).toBeNull();
    });
  });

  it('keeps the membership while another profile of the person still uses it', async () => {
    const person = await createPerson(result.db, institute.tenantId);
    const staffId = await createProfile(result.db, institute.tenantId, 'staff', person);
    const guardianId = await createProfile(result.db, institute.tenantId, 'guardian', person);
    const sessionId = await openSession(result.db, institute.tenantId, person);

    expect((await mutate('deleteStaffMember', staffId)).errors).toBeUndefined();
    expect((await membershipOf(person)).deletedAt).toBeNull();
    expect((await sessionOf(sessionId)).revokedAt).toBeNull();
    expect((await accountRowsReadableByInstitute(person)).users).toBe(1);

    expect((await mutate('deleteGuardian', guardianId)).errors).toBeUndefined();
    expect((await membershipOf(person)).deletedAt).toBeInstanceOf(Date);
    expect((await sessionOf(sessionId)).revokedAt).toBeInstanceOf(Date);

    // Restoring either profile brings the one membership back.
    expect((await mutate('restoreStaffMember', staffId)).errors).toBeUndefined();
    expect((await membershipOf(person)).deletedAt).toBeNull();
  });

  it('leaves a member without any profile untouched', async () => {
    const bystander = await createPerson(result.db, institute.tenantId);
    const person = await createPerson(result.db, institute.tenantId);
    const staffId = await createProfile(result.db, institute.tenantId, 'staff', person);
    expect((await mutate('deleteStaffMember', staffId)).errors).toBeUndefined();
    expect((await membershipOf(bystander)).deletedAt).toBeNull();
    expect(
      (await membershipOf({ ...bystander, membershipId: institute.membershipId })).deletedAt,
    ).toBeNull();
  });

  describe('refusals', () => {
    describe('a member with full control', () => {
      let fifth: TestInstitute;
      let secondAdmin: Person;
      let staffId: string;
      let sessionId: string;
      let clerkToken: string;
      let fifthAdminToken: string;

      const staffDeletedAt = async () => {
        const [row] = await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
          tx
            .select({ deletedAt: staffProfiles.deletedAt })
            .from(staffProfiles)
            .where(eq(staffProfiles.id, staffId)),
        );
        return row.deletedAt;
      };

      beforeAll(async () => {
        fifth = await createTestInstitute(result.db);
        fifthAdminToken = createInstituteToken({
          sub: fifth.userId,
          tenantId: fifth.tenantId,
          membershipId: fifth.membershipId,
          roleId: fifth.roleId,
        });
        // Not the last one: the institute's own admin has full control too.
        secondAdmin = await createPerson(result.db, fifth.tenantId, FULL_CONTROL);
        staffId = await createProfile(result.db, fifth.tenantId, 'staff', secondAdmin);
        sessionId = await openSession(result.db, fifth.tenantId, secondAdmin);
        const clerk = await createPerson(result.db, fifth.tenantId, [
          { action: 'delete', subject: 'Staff' },
          { action: 'restore', subject: 'Staff' },
        ]);
        clerkToken = createInstituteToken({
          sub: clerk.userId,
          tenantId: fifth.tenantId,
          membershipId: clerk.membershipId,
          roleId: clerk.roleId,
        });
      });

      it('is not removed by a caller without full control, and nothing is written', async () => {
        const removed = await mutate('deleteStaffMember', staffId, clerkToken);
        expect(codeOf(removed)).toBe('FULL_CONTROL_REQUIRED');
        expect(await staffDeletedAt()).toBeNull();
        expect((await membershipOf(secondAdmin)).deletedAt).toBeNull();
        expect((await sessionOf(sessionId)).revokedAt).toBeNull();
      });

      it('is not brought back by a caller without full control, and nothing is written', async () => {
        expect(
          (await mutate('deleteStaffMember', staffId, fifthAdminToken)).errors,
        ).toBeUndefined();
        expect((await membershipOf(secondAdmin)).deletedAt).toBeInstanceOf(Date);

        const restored = await mutate('restoreStaffMember', staffId, clerkToken);
        expect(codeOf(restored)).toBe('FULL_CONTROL_REQUIRED');
        expect(await staffDeletedAt()).toBeInstanceOf(Date);
        expect((await membershipOf(secondAdmin)).deletedAt).toBeInstanceOf(Date);
      });

      it('is brought back by a caller with full control', async () => {
        expect(
          (await mutate('restoreStaffMember', staffId, fifthAdminToken)).errors,
        ).toBeUndefined();
        expect((await membershipOf(secondAdmin)).deletedAt).toBeNull();
      });
    });

    it('does not bring back a membership that ended some other way than a profile delete', async () => {
      const person = await createPerson(result.db, institute.tenantId);
      const staffId = await createProfile(result.db, institute.tenantId, 'staff', person);
      const guardianId = await createProfile(result.db, institute.tenantId, 'guardian', person);
      // The staff record goes while the guardian record keeps the membership.
      expect((await mutate('deleteStaffMember', staffId)).errors).toBeUndefined();
      expect((await membershipOf(person)).deletedAt).toBeNull();
      // The platform then ends the membership itself.
      await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
        tx
          .update(memberships)
          .set({ deletedAt: new Date(Date.now() + 5_000), deletedBy: SYSTEM_USER_ID })
          .where(eq(memberships.id, person.membershipId)),
      );

      expect((await mutate('restoreStaffMember', staffId)).errors).toBeUndefined();
      expect((await membershipOf(person)).deletedAt).toBeInstanceOf(Date);
      expect(guardianId).toEqual(expect.any(String));
    });

    it('refuses a caller who would end their own membership, and deletes nothing', async () => {
      const second = await createTestInstitute(result.db);
      const caller: Person = {
        userId: second.userId,
        membershipId: second.membershipId,
        roleId: second.roleId,
        name: 'Caller',
      };
      await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
        tx.insert(tenantUserProfiles).values({
          tenantId: second.tenantId,
          userId: caller.userId,
          firstName: { en: 'Caller' },
          ...AUDIT,
        }),
      );
      // A second member with full control, so only the own-membership rule is in play.
      await createPerson(result.db, second.tenantId, FULL_CONTROL);
      const staffId = await createProfile(result.db, second.tenantId, 'staff', caller);
      const token = createInstituteToken({
        sub: second.userId,
        tenantId: second.tenantId,
        membershipId: second.membershipId,
        roleId: second.roleId,
      });

      const removed = await mutate('deleteStaffMember', staffId, token);
      expect(codeOf(removed)).toBe('CANNOT_REMOVE_OWN_MEMBERSHIP');
      const [profile] = await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
        tx
          .select({ deletedAt: staffProfiles.deletedAt })
          .from(staffProfiles)
          .where(eq(staffProfiles.id, staffId)),
      );
      expect(profile.deletedAt).toBeNull();
      const [membership] = await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
        tx
          .select({ deletedAt: memberships.deletedAt })
          .from(memberships)
          .where(eq(memberships.id, second.membershipId)),
      );
      expect(membership.deletedAt).toBeNull();
    });

    it('lets only another member with full control remove a member with full control', async () => {
      const third = await createTestInstitute(result.db);
      const onlyAdmin: Person = {
        userId: third.userId,
        membershipId: third.membershipId,
        roleId: third.roleId,
        name: 'Only admin',
      };
      await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
        tx.insert(tenantUserProfiles).values({
          tenantId: third.tenantId,
          userId: onlyAdmin.userId,
          firstName: { en: 'Only admin' },
          ...AUDIT,
        }),
      );
      const staffId = await createProfile(result.db, third.tenantId, 'staff', onlyAdmin);
      const clerk = await createPerson(result.db, third.tenantId, [
        { action: 'delete', subject: 'Staff' },
      ]);
      const clerkToken = createInstituteToken({
        sub: clerk.userId,
        tenantId: third.tenantId,
        membershipId: clerk.membershipId,
        roleId: clerk.roleId,
      });

      // A caller without full control is refused before the last-member rule is reached; the
      // database holds that rule for every other path (see the database role tests below).
      const refused = await mutate('deleteStaffMember', staffId, clerkToken);
      expect(codeOf(refused)).toBe('FULL_CONTROL_REQUIRED');
      expect((await membershipOf(onlyAdmin)).deletedAt).toBeNull();

      const second = await createPerson(result.db, third.tenantId, FULL_CONTROL);
      const stillRefused = await mutate('deleteStaffMember', staffId, clerkToken);
      expect(codeOf(stillRefused)).toBe('FULL_CONTROL_REQUIRED');

      const secondToken = createInstituteToken({
        sub: second.userId,
        tenantId: third.tenantId,
        membershipId: second.membershipId,
        roleId: second.roleId,
      });
      const removed = await mutate('deleteStaffMember', staffId, secondToken);
      expect(removed.errors).toBeUndefined();
      expect((await membershipOf(onlyAdmin)).deletedAt).toBeInstanceOf(Date);
    });
  });

  describe('as the institute database role', () => {
    it('PostgreSQL refuses to end the last membership with full control', async () => {
      const fourth = await createTestInstitute(result.db);
      const end = withTenant(result.db, mkInstituteCtx(fourth.tenantId, ORIGIN), (tx) =>
        tx
          .update(memberships)
          .set({ deletedAt: new Date(), deletedBy: SYSTEM_USER_ID })
          .where(eq(memberships.id, fourth.membershipId)),
      );
      await expect(end).rejects.toMatchObject({
        cause: { constraint: 'memberships_keep_full_control_member' },
      });
      const revoke = withTenant(result.db, mkInstituteCtx(fourth.tenantId, ORIGIN), (tx) =>
        tx
          .update(memberships)
          .set({ status: 'REVOKED' })
          .where(eq(memberships.id, fourth.membershipId)),
      );
      await expect(revoke).rejects.toMatchObject({
        cause: { constraint: 'memberships_keep_full_control_member' },
      });
    });

    it('PostgreSQL refuses a membership ended by its own member', async () => {
      const person = await createPerson(result.db, institute.tenantId);
      const end = withTenant(result.db, mkInstituteCtx(institute.tenantId, ORIGIN), (tx) =>
        tx
          .update(memberships)
          .set({ deletedAt: new Date(), deletedBy: person.userId })
          .where(eq(memberships.id, person.membershipId)),
      );
      await expect(end).rejects.toMatchObject({
        cause: { constraint: 'chk_membership_not_ended_by_self' },
      });
    });

    it('a membership that stops being active loses its sessions too', async () => {
      const person = await createPerson(result.db, institute.tenantId);
      const sessionId = await openSession(result.db, institute.tenantId, person);
      await withTenant(result.db, mkInstituteCtx(institute.tenantId, ORIGIN), (tx) =>
        tx
          .update(memberships)
          .set({ status: 'REVOKED' })
          .where(eq(memberships.id, person.membershipId)),
      );
      expect((await sessionOf(sessionId)).revokedReason).toBe('ADMIN_REVOKED');
    });
  });

  describe('a person who comes back in the same role', () => {
    /** A person whose membership ended, as it does with their last profile. */
    async function formerMember(): Promise<Person> {
      const person = await createPerson(result.db, institute.tenantId);
      await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
        tx
          .update(memberships)
          .set({ deletedAt: new Date(), deletedBy: institute.userId })
          .where(eq(memberships.id, person.membershipId)),
      );
      return person;
    }

    const newStaff = (person: Person) =>
      result.app.get(StaffRepository).create({
        tenantId: institute.tenantId,
        userId: person.userId,
        roleId: person.roleId,
        actorId: institute.userId,
        employeeId: null,
        tenantProfile: { firstName: { en: person.name } },
        staff: {
          designation: null,
          department: null,
          dateOfJoining: '2025-04-01',
          employmentType: EmploymentType.REGULAR,
          specialization: null,
          socialCategory: null,
        },
      });

    it.each([
      [
        'IdentityService.createMembership',
        (person: Person) =>
          result.app.get(IdentityRepository).insertInstituteMembership({
            userId: person.userId,
            tenantId: institute.tenantId,
            roleId: person.roleId,
            abilities: [],
            actorId: institute.userId,
          }),
      ],
      [
        'a new guardian',
        async (person: Person) =>
          (
            await result.app.get(GuardianRepository).createMembership({
              tenantId: institute.tenantId,
              userId: person.userId,
              roleId: person.roleId,
              actorId: institute.userId,
              profile: { firstName: { en: person.name } },
            })
          ).id,
      ],
      [
        'a new staff member',
        async (person: Person) => {
          const created = await newStaff(person);
          assert(created.kind === 'ok');
          return created.row.membershipId;
        },
      ],
      [
        'a new bot',
        async (person: Person) =>
          (
            await result.app.get(BotProfileRepository).createBotMembership({
              tenantId: institute.tenantId,
              userId: person.userId,
              roleId: person.roleId,
              createdBy: institute.userId,
            })
          ).id,
      ],
    ] as const)('%s brings the ended membership back instead of adding a second one', async (_path, add) => {
      const person = await formerMember();
      const membershipId = await add(person);
      expect(membershipId).toBe(person.membershipId);
      expect(await membershipOf(person)).toEqual({
        id: person.membershipId,
        deletedAt: null,
        deletedBy: null,
      });
      const rows = await withAdmin(result.db, mkAdminCtx(ORIGIN), (tx) =>
        tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(eq(memberships.userId, person.userId)),
      );
      expect(rows).toHaveLength(1);
    });

    it('allows one record of a kind per membership, so a deleted person returns by restore', async () => {
      const person = await createPerson(result.db, institute.tenantId);
      const staffId = await createProfile(result.db, institute.tenantId, 'staff', person);
      expect((await mutate('deleteStaffMember', staffId)).errors).toBeUndefined();
      expect((await membershipOf(person)).deletedAt).toBeInstanceOf(Date);

      // PostgreSQL refuses a second staff record on the membership, deleted or not, and the
      // refused attempt leaves the membership ended.
      await expect(newStaff(person)).rejects.toMatchObject({
        cause: { constraint: 'staff_profiles_membership_id_key' },
      });
      expect((await membershipOf(person)).deletedAt).toBeInstanceOf(Date);

      expect((await mutate('restoreStaffMember', staffId)).errors).toBeUndefined();
      expect((await membershipOf(person)).deletedAt).toBeNull();
    });
  });
});
