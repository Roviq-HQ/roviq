/**
 * Direct creation (InstituteSetupService.runSetup) and the approval path (adminApproveInstitute
 * starting InstituteSetupWorkflow, whose activities call the same service) must leave an
 * institute in the same state: academic structure, configs, default roles, the board's
 * affiliation and one institute admin for `first_admin_user_id`.
 *
 * `@temporalio/client` is replaced so `approve` runs its real code and the workflow input it
 * would send is captured; the activities then run in workflow order with that input.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { BoardType, DefaultRoles, EducationLevel } from '@roviq/common-types';
import {
  academicYearsLive,
  type DrizzleDB,
  instituteAffiliationsLive,
  instituteConfigsLive,
  instituteNotificationConfigsLive,
  institutesLive,
  membershipsLive,
  mkAdminCtx,
  rolesLive,
  SYSTEM_USER_ID,
  sectionsLive,
  standardSubjectsLive,
  standardsLive,
  subjectsLive,
  tenantUserProfiles,
  userProfiles,
  users,
  withAdmin,
} from '@roviq/database';
import type { EventBusService } from '@roviq/event-bus';
import { withTestContext } from '@roviq/request-context';
import {
  createIntegrationApp,
  createMock,
  createTestInstitute,
  type IntegrationAppResult,
} from '@roviq/testing/integration';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminInstituteService } from '../../../admin/institute/admin-institute.service';
import { AppModule } from '../../../app/app.module';
import { IdentityService } from '../../../auth/identity.service';
import { UserRepository } from '../../../auth/repositories/user.repository';
import { InstituteService } from '../../management/institute.service';
import { InstituteRepository } from '../../management/repositories/institute.repository';
import { InstituteSetupService } from '../../management/seed/institute-setup.service';
import { createInstituteSetupActivities } from '../institute-setup.activities';
import type { InstituteSetupInput } from '../institute-setup.types';

const temporal = vi.hoisted(() => ({ start: vi.fn() }));

vi.mock('@temporalio/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@temporalio/client')>();
  class FakeTemporalClient {
    workflow = { start: temporal.start };
  }
  return {
    ...actual,
    Client: FakeTemporalClient,
    Connection: {
      connect: vi.fn(() => Promise.resolve({ close: vi.fn() })),
      // AppModule's TemporalHealthIndicator builds a lazy connection at boot.
      lazy: vi.fn(() => ({
        close: vi.fn(() => Promise.resolve()),
        withDeadline: <T>(_deadline: number, fn: () => Promise<T>) => fn(),
        healthService: { check: vi.fn(() => Promise.resolve({ status: 1 })) },
      })),
    },
  };
});

const SCHOOL = {
  type: 'SCHOOL',
  departments: [EducationLevel.PRIMARY, EducationLevel.SECONDARY],
  board: BoardType.CBSE,
};

function uniqueEmail(label: string) {
  return `${label}-${randomUUID().slice(0, 8)}@institute-setup.test`;
}

async function snapshot(db: DrizzleDB, tenantId: string) {
  return withAdmin(db, mkAdminCtx('test:institute-setup'), async (tx) => {
    const count = async (query: Promise<Array<{ n: number }>>) => (await query)[0]?.n ?? 0;
    const n = sql<number>`count(*)::int`;
    const [institute] = await tx
      .select({ setupStatus: institutesLive.setupStatus })
      .from(institutesLive)
      .where(eq(institutesLive.id, tenantId));
    const configs = await tx
      .select({ norms: instituteConfigsLive.sectionStrengthNorms })
      .from(instituteConfigsLive)
      .where(eq(instituteConfigsLive.tenantId, tenantId));
    const roleNames = await tx
      .select({ name: sql<string>`${rolesLive.name}->>'en'` })
      .from(rolesLive)
      .where(eq(rolesLive.tenantId, tenantId));
    const affiliations = await tx
      .select({
        board: instituteAffiliationsLive.board,
        status: instituteAffiliationsLive.affiliationStatus,
        validFrom: instituteAffiliationsLive.validFrom,
      })
      .from(instituteAffiliationsLive)
      .where(eq(instituteAffiliationsLive.tenantId, tenantId));
    return {
      setupStatus: institute?.setupStatus,
      academicYears: await count(
        tx.select({ n }).from(academicYearsLive).where(eq(academicYearsLive.tenantId, tenantId)),
      ),
      standards: await count(
        tx.select({ n }).from(standardsLive).where(eq(standardsLive.tenantId, tenantId)),
      ),
      sections: await count(
        tx.select({ n }).from(sectionsLive).where(eq(sectionsLive.tenantId, tenantId)),
      ),
      subjects: await count(
        tx.select({ n }).from(subjectsLive).where(eq(subjectsLive.tenantId, tenantId)),
      ),
      standardSubjects: await count(
        tx
          .select({ n })
          .from(standardSubjectsLive)
          .where(eq(standardSubjectsLive.tenantId, tenantId)),
      ),
      notificationConfigs: await count(
        tx
          .select({ n })
          .from(instituteNotificationConfigsLive)
          .where(eq(instituteNotificationConfigsLive.tenantId, tenantId)),
      ),
      configs: configs.map((c) => c.norms),
      affiliations,
      defaultRoles: roleNames
        .map((r) => r.name)
        .filter((name) => (Object.values(DefaultRoles) as string[]).includes(name))
        .sort(),
    };
  });
}

/** Institute-admin memberships in the institute, with the member's email. */
async function adminMemberships(db: DrizzleDB, tenantId: string) {
  return withAdmin(db, mkAdminCtx('test:institute-setup'), (tx) =>
    tx
      .select({ email: users.email, status: membershipsLive.status, userId: users.id })
      .from(membershipsLive)
      .innerJoin(rolesLive, eq(rolesLive.id, membershipsLive.roleId))
      .innerJoin(users, eq(users.id, membershipsLive.userId))
      .where(
        and(
          eq(membershipsLive.tenantId, tenantId),
          sql`${rolesLive.name}->>'en' = ${DefaultRoles.InstituteAdmin}`,
        ),
      ),
  );
}

async function usersWithEmail(db: DrizzleDB, email: string) {
  return withAdmin(db, mkAdminCtx('test:institute-setup'), (tx) =>
    tx
      .select({
        id: users.id,
        passwordHash: users.passwordHash,
        mustChangePassword: users.mustChangePassword,
      })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`),
  );
}

describe('Institute setup: approval workflow and direct creation (integration)', () => {
  let result: IntegrationAppResult;
  let setup: InstituteSetupService;
  let identity: IdentityService;
  let repo: InstituteRepository;
  let instituteService: InstituteService;

  function asPlatformAdmin<T>(fn: () => Promise<T>): Promise<T> {
    return Promise.resolve(
      withTestContext(fn, { userId: SYSTEM_USER_ID, tenantId: null, scope: 'platform' }),
    );
  }

  function createInstitute(firstAdminEmail: string, label: string) {
    return asPlatformAdmin(() =>
      instituteService.insertWithFirstAdmin({
        name: { en: `Setup ${label}` },
        slug: `setup-${label}-${randomUUID().slice(0, 8)}`,
        ...SCHOOL,
        firstAdmin: { firstName: 'Meera', lastName: 'Joshi', email: firstAdminEmail },
      }),
    );
  }

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    setup = result.app.get(InstituteSetupService);
    identity = result.app.get(IdentityService);
    repo = result.app.get(InstituteRepository);
    instituteService = result.app.get(InstituteService);
  });

  beforeEach(() => {
    temporal.start.mockReset();
    temporal.start.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await result?.close();
  });

  it('approval and direct creation seed the same institute, board and first admin', async () => {
    const welcome = vi.spyOn(identity, 'sendWelcomeNotification');
    const directEmail = uniqueEmail('direct');
    const approvedEmail = uniqueEmail('approved');

    const direct = await createInstitute(directEmail, 'direct');
    await setup.runSetup({ instituteId: direct.id, ...SCHOOL, actorId: SYSTEM_USER_ID });

    const requested = await createInstitute(approvedEmail, 'approved');
    await asPlatformAdmin(() => repo.updateStatus(requested.id, 'PENDING_APPROVAL'));
    await asPlatformAdmin(() => result.app.get(AdminInstituteService).approve(requested.id));
    await vi.waitFor(() => expect(temporal.start).toHaveBeenCalledTimes(1));
    const [workflowType, options] = temporal.start.mock.calls[0] ?? [];
    expect(workflowType).toBe('InstituteSetupWorkflow');
    const input: InstituteSetupInput | undefined = options?.args?.[0];
    assert(input);
    // The board comes back from the affiliation recorded at request time.
    expect(input.board).toBe(SCHOOL.board);

    // The workflow's steps, in the workflow's order, then every step retried.
    const activities = createInstituteSetupActivities(
      result.db,
      createMock<EventBusService>(),
      setup,
    );
    const run = async () => {
      const { instituteId, creatingUserId: actor } = input;
      await activities.updateSetupStatus(instituteId, 'IN_PROGRESS', actor);
      await activities.createDefaultRoles(instituteId, actor);
      await activities.createFirstAdmin(instituteId, actor);
      await activities.createDefaultNotificationConfig(instituteId, actor);
      await activities.createInstituteConfig(instituteId, input.board, actor);
      const yearId = await activities.createFirstAcademicYear(instituteId, actor);
      const counts = await activities.seedAcademicStructure(
        instituteId,
        yearId,
        input.departments,
        input.board,
        input.type,
        actor,
      );
      await activities.updateSetupStatus(instituteId, 'COMPLETED', actor);
      return counts;
    };
    const counts = await run();
    await run();

    const fromDirect = await snapshot(result.db, direct.id);
    const fromWorkflow = await snapshot(result.db, requested.id);
    expect(fromWorkflow).toEqual(fromDirect);
    expect(fromWorkflow.setupStatus).toBe('COMPLETED');
    expect(fromWorkflow.affiliations).toEqual([
      { board: SCHOOL.board, status: 'PROVISIONAL', validFrom: null },
    ]);
    expect(fromWorkflow.academicYears).toBe(1);
    expect(fromWorkflow.standards).toBe(counts.standardsCreated);
    expect(fromWorkflow.sections).toBe(counts.sectionsCreated);
    expect(fromWorkflow.subjects).toBe(counts.subjectsSeeded);
    expect(fromWorkflow.subjects).toBeGreaterThan(0);
    expect(fromWorkflow.notificationConfigs).toBe(3);
    expect(fromWorkflow.configs).toEqual([{ optimal: 40, hardMax: 45, exemptionAllowed: true }]);
    expect(fromWorkflow.defaultRoles).toEqual([...new Set(Object.values(DefaultRoles))].sort());

    for (const [tenantId, email] of [
      [direct.id, directEmail],
      [requested.id, approvedEmail],
    ] as const) {
      const admins = await adminMemberships(result.db, tenantId);
      expect(admins.map(({ email: e, status }) => ({ email: e, status }))).toEqual([
        { email, status: 'ACTIVE' },
      ]);
      expect(await usersWithEmail(result.db, email)).toHaveLength(1);
    }
    // One welcome per setup run while the admin has never logged in; the retry sends another.
    expect(welcome.mock.calls.map(([payload]) => payload.email).sort()).toEqual(
      [directEmail, approvedEmail, approvedEmail].sort(),
    );
    welcome.mockRestore();
  });

  it('gives an account with a real password only the membership, not a new password or profile', async () => {
    const email = uniqueEmail('existing');
    const { userId } = await identity.createUser({
      email,
      username: email,
      actorId: SYSTEM_USER_ID,
      originTenantId: null,
    });
    await result.app.get(UserRepository).updatePassword(userId, await hash('a-real-password'));
    const [before] = await usersWithEmail(result.db, email);
    assert(before);
    const welcome = vi.spyOn(identity, 'sendWelcomeNotification');
    // The email is matched ignoring case.
    const institute = await createInstitute(email.toUpperCase(), 'existing');

    await setup.runSetup({ instituteId: institute.id, ...SCHOOL, actorId: SYSTEM_USER_ID });

    expect(await adminMemberships(result.db, institute.id)).toEqual([
      { email, status: 'ACTIVE', userId },
    ]);
    expect(before.mustChangePassword).toBe(false);
    expect(await usersWithEmail(result.db, email)).toEqual([before]);
    const profiles = await withAdmin(result.db, mkAdminCtx('test:institute-setup'), (tx) =>
      tx.select({ id: userProfiles.id }).from(userProfiles).where(eq(userProfiles.userId, userId)),
    );
    expect(profiles).toEqual([]);
    expect(welcome).not.toHaveBeenCalled();
    welcome.mockRestore();
  });

  it("gives the first admin the institute's own copy of their name", async () => {
    const email = uniqueEmail('copy');
    const institute = await createInstitute(email, 'copy');
    await setup.createDefaultRoles(institute.id);
    const [requested] = await usersWithEmail(result.db, email);
    assert(requested);

    await setup.createFirstAdmin(institute.id, SYSTEM_USER_ID);

    const copies = await withAdmin(result.db, mkAdminCtx('test:institute-setup'), (tx) =>
      tx
        .select({
          tenantId: tenantUserProfiles.tenantId,
          firstName: tenantUserProfiles.firstName,
          lastName: tenantUserProfiles.lastName,
        })
        .from(tenantUserProfiles)
        .where(eq(tenantUserProfiles.userId, requested.id)),
    );
    expect(copies).toEqual([
      { tenantId: institute.id, firstName: { en: 'Meera' }, lastName: { en: 'Joshi' } },
    ]);
  });

  it('gives a never-logged-in admin a fresh temporary password and welcome on every run', async () => {
    const email = uniqueEmail('retry');
    const institute = await createInstitute(email, 'retry');
    await setup.createDefaultRoles(institute.id);
    const welcome = vi.spyOn(identity, 'sendWelcomeNotification');
    const [requested] = await usersWithEmail(result.db, email);
    assert(requested);

    await setup.createFirstAdmin(institute.id, SYSTEM_USER_ID);
    const [afterFirst] = await usersWithEmail(result.db, email);
    await setup.createFirstAdmin(institute.id, SYSTEM_USER_ID);
    const [afterSecond] = await usersWithEmail(result.db, email);
    assert(afterFirst && afterSecond);

    expect(await usersWithEmail(result.db, email)).toHaveLength(1);
    expect(await adminMemberships(result.db, institute.id)).toEqual([
      { email, status: 'ACTIVE', userId: requested.id },
    ]);
    expect(new Set([requested, afterFirst, afterSecond].map((u) => u.passwordHash)).size).toBe(3);
    expect(afterSecond.mustChangePassword).toBe(true);
    expect(welcome).toHaveBeenCalledTimes(2);
    const [first, second] = welcome.mock.calls.map(([payload]) => payload);
    assert(first && second);
    expect(first).toEqual({
      userId: requested.id,
      username: email,
      email,
      phone: undefined,
      firstName: 'Meera',
      lastName: 'Joshi',
      tempPassword: first.tempPassword,
      scope: 'institute',
      tenantId: institute.id,
    });
    expect(second).toEqual({ ...first, tempPassword: second.tempPassword });
    // Only the latest temporary password opens the account.
    expect(await verify(afterSecond.passwordHash, second.tempPassword)).toBe(true);
    expect(await verify(afterSecond.passwordHash, first.tempPassword)).toBe(false);
    welcome.mockRestore();
  });

  it('completes setup without an admin for an institute that has no first admin', async () => {
    const institute = await createTestInstitute(result.db);

    await setup.runSetup({
      instituteId: institute.tenantId,
      ...SCHOOL,
      board: undefined,
      actorId: SYSTEM_USER_ID,
    });

    const state = await snapshot(result.db, institute.tenantId);
    expect(state.setupStatus).toBe('COMPLETED');
    expect(await adminMemberships(result.db, institute.tenantId)).toEqual([]);
  });
});
