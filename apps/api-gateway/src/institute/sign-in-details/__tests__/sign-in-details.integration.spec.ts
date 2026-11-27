/**
 * ROV-315: a staff member or guardian created in the institute portal gets their username and
 * temporary password, and the institute can send new ones until the person first signs in.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DefaultRoles } from '@roviq/common-types';
import {
  academicYears,
  type DrizzleDB,
  mkAdminCtx,
  notificationDeliveries,
  refreshTokens,
  roles,
  SYSTEM_USER_ID,
  sections,
  standards,
  users,
  withAdmin,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import type { JetStreamClient } from '@roviq/nats-jetstream';
import { REDIS_CLIENT } from '@roviq/redis';
import {
  createInMemoryRedis,
  createInstituteToken,
  createIntegrationApp,
  createMock,
  createTestInstitute,
  createTestTeacher,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
  waitForCondition,
} from '@roviq/testing/integration';
import { eq, inArray, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';
import { foreignIdRequests } from '../../../__tests__/foreign-id-requests';
import { AppModule } from '../../../app/app.module';
import { IdentityService } from '../../../auth/identity.service';
import { REDIS_KEYS } from '../../../auth/redis-keys';
import { createStudentAdmissionActivities } from '../../admission/workflows/student-admission.activities';

const ORIGIN = 'test:sign-in-details';
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
const WELCOME = 'NOTIFICATION.user.created';

const PERSON_FIELDS = 'id userId signInStatus signInDetailsSentAt';
const CREATE_STAFF = `mutation ($input: CreateStaffInput!) { createStaffMember(input: $input) { ${PERSON_FIELDS} } }`;
const CREATE_GUARDIAN = `mutation ($input: CreateGuardianInput!) { createGuardian(input: $input) { ${PERSON_FIELDS} } }`;
const GET_STAFF = `query ($id: ID!) { getStaffMember(id: $id) { ${PERSON_FIELDS} } }`;
const LIST_STAFF = `query { listStaff(filter: { first: 100 }) { ${PERSON_FIELDS} } }`;
const LIST_GUARDIANS = `query { listGuardians { ${PERSON_FIELDS} } }`;
const RESEND_STAFF = 'mutation ($id: ID!) { resendStaffSignInDetails(staffProfileId: $id) }';
const RESEND_GUARDIAN =
  'mutation ($id: ID!) { resendGuardianSignInDetails(guardianProfileId: $id) }';
const LOGIN =
  'mutation ($u: String!, $p: String!) { instituteLogin(username: $u, password: $p) { accessToken refreshToken } }';
const REFRESH = 'mutation ($t: String!) { refreshToken(token: $t) { accessToken } }';

interface Person {
  id: string;
  userId: string;
  signInStatus: string;
  signInDetailsSentAt: string | null;
}

interface WelcomeEvent {
  userId: string;
  scope: string;
  tenantId: string | null;
  resellerId: string | null;
  username: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  tempPassword: string;
  mustChangePassword: boolean;
}

interface Institute {
  base: TestInstitute;
  token: string;
  standardId: string;
  academicYearId: string;
}

let phoneCounter = 0;
function mobile(): string {
  phoneCounter += 1;
  return `8${String(Date.now() % 1e7).padStart(7, '0')}${String(phoneCounter).padStart(2, '0')}`;
}

function codeOf(res: { errors?: readonly { extensions?: Record<string, unknown> }[] }) {
  return res.errors?.[0]?.extensions?.code;
}

function isWelcome(data: unknown): data is WelcomeEvent {
  return typeof data === 'object' && data !== null && 'tempPassword' in data;
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
    for (const name of [DefaultRoles.Student, DefaultRoles.Parent, DefaultRoles.Teacher]) {
      await tx.insert(roles).values({
        name: { en: name },
        scope: 'institute',
        tenantId: base.tenantId,
        abilities: [],
        isDefault: false,
        isSystem: false,
        ...BY,
      });
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
    await tx.insert(sections).values({
      tenantId: base.tenantId,
      standardId: std.id,
      academicYearId: year.id,
      name: { en: 'A' },
      displayLabel: 'Class 5-A',
      capacity: 40,
      ...BY,
    });
    return { base, token, standardId: std.id, academicYearId: year.id };
  });
}

describe('Sign-in details for staff and guardians (integration)', () => {
  let app: IntegrationAppResult;
  let redis: Redis;
  let emit: MockInstance<EventBusService['emit']>;
  let jetStream: JetStreamClient;
  let a: Institute;
  let b: Institute;
  let teacherToken: string;

  /** People of institute B that institute A asks about. */
  const peopleOfB: string[] = [];
  const request = foreignIdRequests({
    httpServer: () => app.httpServer,
    foreignIds: () => peopleOfB,
    specFile: __filename,
  });

  const gql = <T>(query: string, variables: Record<string, unknown>, token: string) =>
    request<T>({ query, variables, token });

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(app.db, mkAdminCtx(ORIGIN), fn);

  function welcomes(): WelcomeEvent[] {
    return emit.mock.calls
      .filter(([pattern]) => pattern === WELCOME)
      .map(([, data]) => {
        assert(isWelcome(data));
        return data;
      });
  }

  async function createStaff(inst: Institute, extra: Record<string, unknown>) {
    const res = await gql<{ createStaffMember: Person }>(
      CREATE_STAFF,
      { input: { firstName: { en: 'Kiran' }, lastName: { en: 'Das' }, ...extra } },
      inst.token,
    );
    expect(res.errors).toBeUndefined();
    assert(res.data);
    return { person: res.data.createStaffMember, response: JSON.stringify(res) };
  }

  async function createGuardian(inst: Institute, extra: Record<string, unknown>) {
    const res = await gql<{ createGuardian: Person }>(
      CREATE_GUARDIAN,
      { input: { firstName: { en: 'Sunita' }, lastName: { en: 'Rao' }, ...extra } },
      inst.token,
    );
    expect(res.errors).toBeUndefined();
    assert(res.data);
    return { person: res.data.createGuardian, response: JSON.stringify(res) };
  }

  async function passwordHashOf(userId: string) {
    const [row] = await asAdmin((tx) =>
      tx
        .select({ passwordHash: users.passwordHash, username: users.username })
        .from(users)
        .where(eq(users.id, userId)),
    );
    assert(row);
    return row.passwordHash;
  }

  async function usernameOf(userId: string) {
    const [row] = await asAdmin((tx) =>
      tx.select({ username: users.username }).from(users).where(eq(users.id, userId)),
    );
    assert(row);
    return row.username;
  }

  function login(username: string, password: string) {
    return gqlRequest<{ instituteLogin: { accessToken: string; refreshToken: string } }>(
      app.httpServer,
      { query: LOGIN, variables: { u: username, p: password } },
    );
  }

  /** The next resend is not refused for being within a minute of the last one. */
  async function letAMinutePass(userId: string) {
    await redis.del(`${REDIS_KEYS.SIGN_IN_RESEND}${userId}:minute`);
  }

  beforeAll(async () => {
    redis = createInMemoryRedis();
    app = await createIntegrationApp({
      modules: [AppModule],
      overrides: [{ provide: REDIS_CLIENT, useValue: redis }],
    });
    jetStream = app.app.get<string, JetStreamClient>('JETSTREAM_CLIENT', { strict: false });
    a = await setUpInstitute(app.db);
    b = await setUpInstitute(app.db);
    const teacher = await createTestTeacher(app.db, a.base.tenantId);
    teacherToken = createInstituteToken({
      sub: teacher.userId,
      tenantId: a.base.tenantId,
      membershipId: teacher.membershipId,
      roleId: teacher.roleId,
    });
  });

  // Per test: the config restores spies between tests. Every module has its own bus instance.
  beforeEach(() => {
    emit = vi.spyOn(EventBusService.prototype, 'emit');
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('on create', () => {
    it('sends one welcome with the staff member’s email, institute scope and the institute', async () => {
      const email = `kiran.${randomUUID().slice(0, 8)}@example.in`;

      const { person } = await createStaff(a, { email });

      const sent = welcomes();
      expect(sent).toHaveLength(1);
      const [welcome] = sent;
      assert(welcome);
      expect(welcome.tempPassword).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(welcome).toEqual({
        userId: person.userId,
        scope: 'institute',
        tenantId: a.base.tenantId,
        resellerId: null,
        username: await usernameOf(person.userId),
        email,
        phone: null,
        firstName: 'Kiran',
        lastName: 'Das',
        tempPassword: welcome.tempPassword,
        mustChangePassword: true,
      });
      expect(person.signInStatus).toBe('NOT_SENT');
    });

    it('sends a guardian with only a phone the phone and no email, never the placeholder', async () => {
      const phone = mobile();

      const { person } = await createGuardian(a, { phone });

      const sent = welcomes();
      expect(sent).toHaveLength(1);
      const [welcome] = sent;
      assert(welcome);
      expect(welcome.email).toBeNull();
      expect(welcome.phone).toBe(`+91${phone}`);
      expect(welcome.userId).toBe(person.userId);
      expect(JSON.stringify(welcome)).not.toContain('roviq.placeholder');
      // A phone is a real contact: no delivery row yet, so "not sent", never "no contact".
      expect(person.signInStatus).toBe('NOT_SENT');
    });

    it('sends nothing to a person with neither, and shows NOT_SENT_NO_CONTACT', async () => {
      const staff = await createStaff(a, {});
      const guardian = await createGuardian(a, {});

      expect(welcomes()).toEqual([]);
      expect(staff.person.signInStatus).toBe('NOT_SENT_NO_CONTACT');
      expect(guardian.person.signInStatus).toBe('NOT_SENT_NO_CONTACT');
      const read = await gql<{ getStaffMember: Person }>(
        GET_STAFF,
        { id: staff.person.id },
        a.token,
      );
      expect(read.data?.getStaffMember.signInStatus).toBe('NOT_SENT_NO_CONTACT');
    });

    describe('in the admission workflow', () => {
      async function admit(parentPhone: string) {
        const activities = createStudentAdmissionActivities(
          app.db,
          createMock<EventBusService>(),
          app.app.get(IdentityService),
        );
        const seed = randomUUID();
        const formData = { studentName: 'Admitted Child', parentName: 'Typed Parent', parentPhone };
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
        return student.userId;
      }

      it('texts a new guardian, and never the student', async () => {
        const phone = mobile();

        const studentUserId = await admit(phone);

        const sent = welcomes();
        expect(sent).toHaveLength(1);
        const [welcome] = sent;
        assert(welcome);
        expect(welcome.userId).not.toBe(studentUserId);
        expect([welcome.email, welcome.phone, welcome.firstName, welcome.scope]).toEqual([
          null,
          `+91${phone}`,
          'Typed Parent',
          'institute',
        ]);
      });

      it('sends nothing to an existing guardian it links, and leaves their password', async () => {
        const phone = mobile();
        const { person } = await createGuardian(a, { phone });
        const hashBefore = await passwordHashOf(person.userId);
        emit.mockClear();

        await admit(phone);

        expect(welcomes()).toEqual([]);
        expect(await passwordHashOf(person.userId)).toBe(hashBefore);
      });
    });
  });

  describe('resend', () => {
    it("refuses another institute's staff member and guardian as not found, changing nothing", async () => {
      const staff = await createStaff(b, { email: `b.${randomUUID().slice(0, 8)}@example.in` });
      const guardian = await createGuardian(b, { phone: mobile() });
      const staffHash = await passwordHashOf(staff.person.userId);
      const guardianHash = await passwordHashOf(guardian.person.userId);
      const personIds = [staff.person.userId, guardian.person.userId];
      peopleOfB.push(staff.person.id, guardian.person.id);
      const stored = () =>
        asAdmin(async (tx) => ({
          users: await tx.select().from(users).where(inArray(users.id, personIds)),
          tokens: await tx
            .select()
            .from(refreshTokens)
            .where(inArray(refreshTokens.userId, personIds)),
          deliveries: await tx
            .select()
            .from(notificationDeliveries)
            .where(inArray(notificationDeliveries.tenantId, [a.base.tenantId, b.base.tenantId])),
        }));
      const before = await stored();
      emit.mockClear();

      const staffRes = await gql(RESEND_STAFF, { id: staff.person.id }, a.token);
      const guardianRes = await gql(RESEND_GUARDIAN, { id: guardian.person.id }, a.token);

      expect(codeOf(staffRes)).toBe('STAFF_NOT_FOUND');
      expect(codeOf(guardianRes)).toBe('GUARDIAN_NOT_FOUND');
      expect(staffRes.data).toBeNull();
      expect(guardianRes.data).toBeNull();
      expect(welcomes()).toEqual([]);
      expect(await passwordHashOf(staff.person.userId)).toBe(staffHash);
      expect(await passwordHashOf(guardian.person.userId)).toBe(guardianHash);
      expect(await stored()).toEqual(before);
    });

    it('replaces the temporary password and revokes the sessions the old one opened', async () => {
      const { person } = await createStaff(a, {
        email: `r.${randomUUID().slice(0, 8)}@example.in`,
      });
      const [first] = welcomes();
      assert(first);
      const username = await usernameOf(person.userId);
      const session = (await login(username, first.tempPassword)).data?.instituteLogin;
      assert(session);
      emit.mockClear();

      const res = await gql<{ resendStaffSignInDetails: boolean }>(
        RESEND_STAFF,
        { id: person.id },
        a.token,
      );

      expect(res.errors).toBeUndefined();
      expect(res.data?.resendStaffSignInDetails).toBe(true);
      const [second] = welcomes();
      assert(second);
      expect(second.tempPassword).not.toBe(first.tempPassword);
      expect(second.email).toBe(first.email);
      expect(codeOf(await login(username, first.tempPassword))).toBe('INVALID_CREDENTIALS');
      const refreshed = await gqlRequest(app.httpServer, {
        query: REFRESH,
        variables: { t: session.refreshToken },
      });
      expect(codeOf(refreshed)).toBe('SESSION_EXPIRED');
      const tokens = await asAdmin((tx) =>
        tx
          .select({ revokedAt: refreshTokens.revokedAt })
          .from(refreshTokens)
          .where(eq(refreshTokens.userId, person.userId)),
      );
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens.every((t) => t.revokedAt !== null)).toBe(true);
      const fresh = await login(username, second.tempPassword);
      expect(fresh.errors).toBeUndefined();
      expect(typeof fresh.data?.instituteLogin.accessToken).toBe('string');
    });

    it('resends a guardian’s details to their phone', async () => {
      const phone = mobile();
      const { person } = await createGuardian(a, { phone });
      emit.mockClear();

      const res = await gql(RESEND_GUARDIAN, { id: person.id }, a.token);

      expect(res.errors).toBeUndefined();
      const [welcome] = welcomes();
      assert(welcome);
      expect([welcome.userId, welcome.email, welcome.phone]).toEqual([
        person.userId,
        null,
        `+91${phone}`,
      ]);
    });

    it('refuses a person who has completed first sign-in, password unchanged', async () => {
      const staff = await createStaff(a, { email: `s.${randomUUID().slice(0, 8)}@example.in` });
      const guardian = await createGuardian(a, { phone: mobile() });
      for (const userId of [staff.person.userId, guardian.person.userId]) {
        await asAdmin((tx) =>
          tx.update(users).set({ mustChangePassword: false }).where(eq(users.id, userId)),
        );
      }
      const staffHash = await passwordHashOf(staff.person.userId);
      const guardianHash = await passwordHashOf(guardian.person.userId);
      emit.mockClear();

      const staffRes = await gql(RESEND_STAFF, { id: staff.person.id }, a.token);
      const guardianRes = await gql(RESEND_GUARDIAN, { id: guardian.person.id }, a.token);

      expect(codeOf(staffRes)).toBe('SIGN_IN_ALREADY_COMPLETED');
      expect(codeOf(guardianRes)).toBe('SIGN_IN_ALREADY_COMPLETED');
      expect(welcomes()).toEqual([]);
      expect(await passwordHashOf(staff.person.userId)).toBe(staffHash);
      expect(await passwordHashOf(guardian.person.userId)).toBe(guardianHash);
      const read = await gql<{ getStaffMember: Person }>(
        GET_STAFF,
        { id: staff.person.id },
        a.token,
      );
      expect(read.data?.getStaffMember.signInStatus).toBe('SIGNED_IN');
    });

    it('refuses a person with no real contact, password unchanged', async () => {
      const staff = await createStaff(a, {});
      const guardian = await createGuardian(a, {});
      const staffHash = await passwordHashOf(staff.person.userId);
      const guardianHash = await passwordHashOf(guardian.person.userId);

      const staffRes = await gql(RESEND_STAFF, { id: staff.person.id }, a.token);
      const guardianRes = await gql(RESEND_GUARDIAN, { id: guardian.person.id }, a.token);

      expect(codeOf(staffRes)).toBe('SIGN_IN_CONTACT_MISSING');
      expect(codeOf(guardianRes)).toBe('SIGN_IN_CONTACT_MISSING');
      expect(welcomes()).toEqual([]);
      expect(await passwordHashOf(staff.person.userId)).toBe(staffHash);
      expect(await passwordHashOf(guardian.person.userId)).toBe(guardianHash);
    });

    it('puts the temporary password in no response, audit event or stored row', async () => {
      const emitCalls = vi.mocked(jetStream.emit).mock.calls;
      const callsBefore = emitCalls.length;
      const created = await createStaff(a, { email: `p.${randomUUID().slice(0, 8)}@example.in` });
      const resend = await gql(RESEND_STAFF, { id: created.person.id }, a.token);
      const passwords = welcomes().map((w) => w.tempPassword);
      expect(passwords).toHaveLength(2);
      // The audit event is published after the response.
      await waitForCondition(async () =>
        emitCalls.slice(callsBefore).some(([subject]) => subject === 'AUDIT.log'),
      );

      const published = emitCalls
        .slice(callsBefore)
        .filter(([subject]) => subject !== WELCOME)
        .map(([subject, data]) => `${String(subject)} ${JSON.stringify(data)}`);
      const stored = await asAdmin(async (tx) => {
        const rows = await tx.execute<{ row: string }>(sql`
          SELECT row_to_json(a)::text AS row FROM audit_logs a WHERE a.tenant_id = ${a.base.tenantId}
          UNION ALL
          SELECT row_to_json(n)::text FROM notifications n WHERE n.tenant_id = ${a.base.tenantId}
          UNION ALL
          SELECT row_to_json(d)::text FROM notification_deliveries d WHERE d.tenant_id = ${a.base.tenantId}
        `);
        return rows.rows.map((r) => r.row);
      });
      for (const password of passwords) {
        for (const text of [created.response, JSON.stringify(resend), ...published, ...stored]) {
          expect(text).not.toContain(password);
        }
      }
    });

    it('refuses a second resend within a minute and a sixth in a day', async () => {
      const { person } = await createStaff(a, {
        email: `l.${randomUUID().slice(0, 8)}@example.in`,
      });

      expect((await gql(RESEND_STAFF, { id: person.id }, a.token)).errors).toBeUndefined();
      const tooSoon = await gql(RESEND_STAFF, { id: person.id }, a.token);
      expect(codeOf(tooSoon)).toBe('TOO_MANY_REQUESTS');

      for (let sent = 2; sent <= 5; sent += 1) {
        await letAMinutePass(person.userId);
        expect((await gql(RESEND_STAFF, { id: person.id }, a.token)).errors).toBeUndefined();
      }
      await letAMinutePass(person.userId);
      emit.mockClear();
      const hashBefore = await passwordHashOf(person.userId);
      const sixth = await gql(RESEND_STAFF, { id: person.id }, a.token);

      expect(codeOf(sixth)).toBe('TOO_MANY_REQUESTS');
      expect(welcomes()).toEqual([]);
      expect(await passwordHashOf(person.userId)).toBe(hashBefore);
    });

    it('refuses a role without the update ability on both mutations', async () => {
      const staff = await createStaff(a, { email: `t.${randomUUID().slice(0, 8)}@example.in` });
      const guardian = await createGuardian(a, { phone: mobile() });
      emit.mockClear();

      const staffRes = await gql(RESEND_STAFF, { id: staff.person.id }, teacherToken);
      const guardianRes = await gql(RESEND_GUARDIAN, { id: guardian.person.id }, teacherToken);

      expect(codeOf(staffRes)).toBe('FORBIDDEN');
      expect(codeOf(guardianRes)).toBe('FORBIDDEN');
      expect(welcomes()).toEqual([]);
    });
  });

  describe('status on the lists', () => {
    async function recordDelivery(
      tenantId: string,
      userId: string,
      channel: 'EMAIL' | 'SMS',
      outcome: { status: 'SENT' } | { status: 'FAILED'; errorCode: string },
    ) {
      const [row] = await asAdmin((tx) =>
        tx
          .insert(notificationDeliveries)
          .values({
            scope: 'institute',
            tenantId,
            recipientUserId: userId,
            type: 'USER_WELCOME',
            channel,
            provider: 'test',
            status: outcome.status,
            errorCode: outcome.status === 'FAILED' ? outcome.errorCode : null,
          })
          .returning({ createdAt: notificationDeliveries.createdAt }),
      );
      assert(row);
      return row.createdAt;
    }

    it("reads this institute's deliveries only, for every row of a page", async () => {
      const sentStaff = await createStaff(a, { email: `d.${randomUUID().slice(0, 8)}@example.in` });
      const failedStaff = await createStaff(a, { phone: mobile() });
      const failedGuardian = await createGuardian(a, { phone: mobile() });
      const sentAt = await recordDelivery(a.base.tenantId, sentStaff.person.userId, 'EMAIL', {
        status: 'SENT',
      });
      await recordDelivery(a.base.tenantId, failedStaff.person.userId, 'SMS', {
        status: 'FAILED',
        errorCode: 'ECONNECTION',
      });
      await recordDelivery(a.base.tenantId, failedGuardian.person.userId, 'SMS', {
        status: 'FAILED',
        errorCode: 'ECONNECTION',
      });
      // Another institute's send to the same person is not this institute's to report.
      await recordDelivery(b.base.tenantId, failedStaff.person.userId, 'SMS', { status: 'SENT' });

      const staff = await gql<{ listStaff: Person[] }>(LIST_STAFF, {}, a.token);
      const guardians = await gql<{ listGuardians: Person[] }>(LIST_GUARDIANS, {}, a.token);

      expect(staff.errors).toBeUndefined();
      const byId = new Map(staff.data?.listStaff.map((p) => [p.id, p]));
      expect(byId.get(sentStaff.person.id)).toEqual({
        ...sentStaff.person,
        signInStatus: 'DETAILS_SENT',
        signInDetailsSentAt: sentAt.toISOString(),
      });
      expect(byId.get(failedStaff.person.id)?.signInStatus).toBe('SEND_FAILED');
      expect(
        guardians.data?.listGuardians.find((p) => p.id === failedGuardian.person.id)?.signInStatus,
      ).toBe('SEND_FAILED');
    });
  });
});
