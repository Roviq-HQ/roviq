/**
 * ROV-84 — soft delete + audit columns on identity, guardian-link, passkey and
 * group-member tables, exercised through the real resolver → RLS pipeline.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import {
  AcademicStatus,
  AdmissionType,
  DefaultRoles,
  DomainGroupType,
  GroupMembershipType,
  SocialCategory,
} from '@roviq/common-types';
import {
  authProviders,
  authProvidersLive,
  type DrizzleDB,
  groupMembers,
  groupMembersLive,
  memberships,
  mkAdminCtx,
  roles,
  SYSTEM_USER_ID,
  studentGuardianLinks,
  studentGuardianLinksLive,
  studentProfiles,
  tenantUserProfiles,
  userProfiles,
  users,
  withAdmin,
} from '@roviq/database';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  gqlRequest,
  type IntegrationAppResult,
  signedInAs,
  type TestInstitute,
} from '@roviq/testing/integration';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app/app.module';
import { AuthProviderRepository } from '../passkey/repositories/auth-provider.repository';

const PASSWORD = 'Rov84-soft-delete!';

interface StudentFixture {
  studentProfileId: string;
  membershipId: string;
}

async function createStudentFixture(db: DrizzleDB, tenantId: string): Promise<StudentFixture> {
  const suffix = randomUUID().slice(0, 8);
  return withAdmin(db, mkAdminCtx('test:soft-delete-audit'), async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email: `rov84_${suffix}@test.local`,
        username: `rov84_${suffix}`,
        passwordHash: 'not-a-real-hash',
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .returning({ id: users.id });
    await tx.insert(userProfiles).values({
      userId: user.id,
      firstName: { en: `Student ${suffix}` },
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });
    await tx.insert(tenantUserProfiles).values({
      tenantId: tenantId,
      userId: user.id,
      firstName: { en: `Student ${suffix}` },
      createdBy: SYSTEM_USER_ID,
      updatedBy: SYSTEM_USER_ID,
    });
    const [role] = await tx
      .insert(roles)
      .values({
        name: { en: `Student Role ${suffix}` },
        scope: 'institute',
        tenantId,
        abilities: [],
        isDefault: false,
        isSystem: false,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .returning({ id: roles.id });
    const [membership] = await tx
      .insert(memberships)
      .values({
        userId: user.id,
        roleId: role.id,
        tenantId,
        abilities: [],
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .returning({ id: memberships.id });
    const [profile] = await tx
      .insert(studentProfiles)
      .values({
        tenantId,
        userId: user.id,
        membershipId: membership.id,
        admissionNumber: `ADM-${suffix}`,
        admissionDate: '2025-04-01',
        admissionType: AdmissionType.NEW,
        academicStatus: AcademicStatus.ENROLLED,
        socialCategory: SocialCategory.GENERAL,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      })
      .returning({ id: studentProfiles.id });
    return { studentProfileId: profile.id, membershipId: membership.id };
  });
}

describe('Soft delete + audit columns (integration)', () => {
  let result: IntegrationAppResult;
  let institute: TestInstitute;
  let token: string;
  let student: StudentFixture;

  const admin = <T>(fn: Parameters<typeof withAdmin<T>>[2]) =>
    withAdmin(result.db, mkAdminCtx('test:soft-delete-audit'), fn);

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    institute = await createTestInstitute(result.db, { password: PASSWORD });
    token = createInstituteToken({
      sub: institute.userId,
      tenantId: institute.tenantId,
      membershipId: institute.membershipId,
      roleId: institute.roleId,
    });
    student = await createStudentFixture(result.db, institute.tenantId);
  });

  afterAll(async () => {
    await result?.close();
  });

  describe('guardian links', () => {
    const LINK = /* GraphQL */ `
      mutation Link($input: LinkGuardianInput!) {
        linkGuardianToStudent(input: $input) { id }
      }
    `;
    const guardianIds: string[] = [];

    async function link(guardianProfileId: string, isPrimaryContact: boolean) {
      return gqlRequest<{ linkGuardianToStudent: { id: string } }>(result.httpServer, {
        query: LINK,
        token,
        variables: {
          input: {
            guardianProfileId,
            studentProfileId: student.studentProfileId,
            relationship: 'FATHER',
            isPrimaryContact,
          },
        },
      });
    }

    beforeAll(async () => {
      // createGuardian attaches the institute's Parent role; a test institute has none.
      await admin((tx) =>
        tx.insert(roles).values({
          name: { en: DefaultRoles.Parent },
          scope: 'institute',
          tenantId: institute.tenantId,
          abilities: [],
          isDefault: false,
          isSystem: false,
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        }),
      );
      for (const name of ['Ramesh', 'Suresh']) {
        const created = await gqlRequest<{ createGuardian: { id: string } }>(result.httpServer, {
          query: /* GraphQL */ `
            mutation CreateGuardian($input: CreateGuardianInput!) {
              createGuardian(input: $input) { id }
            }
          `,
          token,
          variables: { input: { firstName: { en: name } } },
        });
        expect(created.errors).toBeUndefined();
        assert(created.data);
        guardianIds.push(created.data.createGuardian.id);
      }
      expect((await link(guardianIds[0], true)).errors).toBeUndefined();
      expect((await link(guardianIds[1], false)).errors).toBeUndefined();
    });

    it('records the acting user as created_by on a new link', async () => {
      const rows = await admin((tx) =>
        tx
          .select({ createdBy: studentGuardianLinksLive.createdBy })
          .from(studentGuardianLinksLive)
          .where(eq(studentGuardianLinksLive.studentProfileId, student.studentProfileId)),
      );
      expect(rows.map((r) => r.createdBy)).toEqual([institute.userId, institute.userId]);
    });

    it('unlink soft-deletes the link and frees the pair for relinking', async () => {
      const unlinked = await gqlRequest<{ unlinkGuardianFromStudent: boolean }>(result.httpServer, {
        query: /* GraphQL */ `
          mutation Unlink($input: UnlinkGuardianInput!) {
            unlinkGuardianFromStudent(input: $input)
          }
        `,
        token,
        variables: {
          input: { guardianProfileId: guardianIds[1], studentProfileId: student.studentProfileId },
        },
      });
      expect(unlinked.errors).toBeUndefined();
      expect(unlinked.data?.unlinkGuardianFromStudent).toBe(true);

      const pair = and(
        eq(studentGuardianLinks.studentProfileId, student.studentProfileId),
        eq(studentGuardianLinks.guardianProfileId, guardianIds[1]),
      );
      const base = await admin((tx) =>
        tx
          .select({
            deletedAt: studentGuardianLinks.deletedAt,
            deletedBy: studentGuardianLinks.deletedBy,
          })
          .from(studentGuardianLinks)
          .where(pair),
      );
      expect(base).toHaveLength(1);
      expect(base[0].deletedAt).toBeInstanceOf(Date);
      expect(base[0].deletedBy).toBe(institute.userId);

      const live = await admin((tx) =>
        tx
          .select({ id: studentGuardianLinksLive.id })
          .from(studentGuardianLinksLive)
          .where(
            and(
              eq(studentGuardianLinksLive.studentProfileId, student.studentProfileId),
              eq(studentGuardianLinksLive.guardianProfileId, guardianIds[1]),
            ),
          ),
      );
      expect(live).toEqual([]);

      const relinked = await link(guardianIds[1], false);
      expect(relinked.errors).toBeUndefined();
      const after = await admin((tx) =>
        tx.select({ id: studentGuardianLinks.id }).from(studentGuardianLinks).where(pair),
      );
      expect(after).toHaveLength(2);
    });
  });

  describe('dynamic group members', () => {
    const RESOLVE = /* GraphQL */ `
      mutation Resolve($groupId: ID!) {
        resolveGroupMembers(groupId: $groupId) { memberCount }
      }
    `;

    async function resolve(groupId: string): Promise<number> {
      const response = await gqlRequest<{ resolveGroupMembers: { memberCount: number } }>(
        result.httpServer,
        { query: RESOLVE, token, variables: { groupId } },
      );
      expect(response.errors).toBeUndefined();
      assert(response.data);
      return response.data.resolveGroupMembers.memberCount;
    }

    const memberRows = (groupId: string) =>
      admin((tx) =>
        tx
          .select({
            id: groupMembers.id,
            deletedAt: groupMembers.deletedAt,
            deletedBy: groupMembers.deletedBy,
          })
          .from(groupMembers)
          .where(eq(groupMembers.groupId, groupId)),
      );

    it('re-resolve keeps unchanged members and soft-deletes the ones that left', async () => {
      const created = await gqlRequest<{ createGroup: { id: string } }>(result.httpServer, {
        query: /* GraphQL */ `
          mutation CreateGroup($input: CreateGroupInput!) {
            createGroup(input: $input) { id }
          }
        `,
        token,
        variables: {
          input: {
            name: `Enrolled ${randomUUID().slice(0, 8)}`,
            groupType: DomainGroupType.CLUB,
            membershipType: GroupMembershipType.DYNAMIC,
            memberTypes: ['student'],
            rule: { '==': [{ var: 'academic_status' }, AcademicStatus.ENROLLED] },
          },
        },
      });
      expect(created.errors).toBeUndefined();
      assert(created.data);
      const groupId = created.data.createGroup.id;

      expect(await resolve(groupId)).toBe(1);
      const first = await memberRows(groupId);
      expect(first).toHaveLength(1);
      expect(first[0].deletedAt).toBeNull();

      expect(await resolve(groupId)).toBe(1);
      expect(await memberRows(groupId)).toEqual(first);

      await admin((tx) =>
        tx
          .update(studentProfiles)
          .set({ academicStatus: AcademicStatus.TRANSFERRED_OUT, updatedBy: SYSTEM_USER_ID })
          .where(eq(studentProfiles.id, student.studentProfileId)),
      );

      expect(await resolve(groupId)).toBe(0);
      const afterLeave = await memberRows(groupId);
      expect(afterLeave).toHaveLength(1);
      expect(afterLeave[0].id).toBe(first[0].id);
      expect(afterLeave[0].deletedAt).toBeInstanceOf(Date);
      expect(afterLeave[0].deletedBy).toBe(institute.userId);

      const live = await admin((tx) =>
        tx
          .select({ id: groupMembersLive.id })
          .from(groupMembersLive)
          .where(eq(groupMembersLive.groupId, groupId)),
      );
      expect(live).toEqual([]);
    });
  });

  describe('passkeys', () => {
    it('delete soft-deletes the credential and lets it be registered again', async () => {
      const repo = result.app.get(AuthProviderRepository);
      const credentialId = `cred-${randomUUID()}`;
      const owner = signedInAs(institute.userId);
      const data = {
        provider: 'passkey' as const,
        providerUserId: credentialId,
        providerData: { counter: 0 },
      };

      const created = await repo.create(owner, data);
      expect(await repo.deletePasskey(owner, created.id)).toBe(1);
      expect(await repo.deletePasskey(owner, created.id)).toBe(0);
      expect(await repo.findByCredentialId(credentialId)).toBeNull();

      const base = await admin((tx) =>
        tx
          .select({ deletedBy: authProviders.deletedBy, createdBy: authProviders.createdBy })
          .from(authProviders)
          .where(eq(authProviders.id, created.id)),
      );
      expect(base).toEqual([{ deletedBy: institute.userId, createdBy: institute.userId }]);

      const again = await repo.create(owner, data);
      const live = await admin((tx) =>
        tx
          .select({ id: authProvidersLive.id })
          .from(authProvidersLive)
          .where(eq(authProvidersLive.providerUserId, credentialId)),
      );
      expect(live).toEqual([{ id: again.id }]);
    });
  });

  // Last: it soft-deletes the suite's admin user.
  describe('soft-deleted user', () => {
    const LOGIN = /* GraphQL */ `
      mutation Login($username: String!, $password: String!) {
        instituteLogin(username: $username, password: $password) { accessToken refreshToken }
      }
    `;
    const REFRESH = /* GraphQL */ `
      mutation Refresh($token: String!) {
        refreshToken(token: $token) { accessToken }
      }
    `;

    it('cannot log in or refresh a token', async () => {
      const login = await gqlRequest<{
        instituteLogin: { accessToken: string | null; refreshToken: string | null };
      }>(result.httpServer, {
        query: LOGIN,
        variables: { username: institute.username, password: PASSWORD },
      });
      expect(login.errors).toBeUndefined();
      const refreshToken = login.data?.instituteLogin.refreshToken;
      assert(refreshToken);

      await admin((tx) =>
        tx
          .update(users)
          .set({ deletedAt: new Date(), deletedBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID })
          .where(eq(users.id, institute.userId)),
      );

      const refreshed = await gqlRequest(result.httpServer, {
        query: REFRESH,
        variables: { token: refreshToken },
      });
      expect(refreshed.errors?.[0]?.extensions?.code).toBe('SESSION_EXPIRED');

      const relogin = await gqlRequest(result.httpServer, {
        query: LOGIN,
        variables: { username: institute.username, password: PASSWORD },
      });
      expect(relogin.errors?.[0]?.extensions?.code).toBe('INVALID_CREDENTIALS');
    });
  });
});
