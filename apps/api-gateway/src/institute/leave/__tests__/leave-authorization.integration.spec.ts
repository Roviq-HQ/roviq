import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_ROLE_ABILITIES,
  type DefaultRole,
  Gender,
  GuardianRelationship,
} from '@roviq/common-types';
import {
  academicYears,
  type DrizzleDB,
  guardianProfiles,
  leaves,
  memberships,
  mkAdminCtx,
  roles,
  SYSTEM_USER_ID,
  sections,
  standards,
  studentAcademics,
  studentGuardianLinks,
  studentProfiles,
  tenantUserProfiles,
  userProfiles,
  withAdmin,
} from '@roviq/database';
import {
  cleanupTestInstitute,
  cleanupTestTeacher,
  createInstituteToken,
  createIntegrationApp,
  createPlatformToken,
  createTestInstitute,
  createTestTeacher,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
  type TestTeacher,
} from '@roviq/testing/integration';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';

interface Actor extends TestTeacher {
  token: string;
}
interface StoredLeave {
  userId: string;
  status: string;
  decidedBy: string | null;
  deletedAt: Date | null;
}

const by = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
const CTX = 'test:leave-authorization';
const DAY = '2026-12-01';
const APPLY =
  'mutation($u: ID!) { applyLeave(input: { userId: $u, startDate: "2026-12-02", endDate: "2026-12-02", type: CASUAL, reason: "ROV-304 apply" }) { id userId status } }';
const LIST = 'query { leaves { id } }';
const ONE = 'query($id: ID!) { leave(id: $id) { id userId } }';
const APPROVE = 'mutation($id: ID!) { approveLeave(id: $id) { id status decidedBy } }';
const REJECT = 'mutation($id: ID!) { rejectLeave(id: $id) { id status decidedBy } }';
const CANCEL = 'mutation($id: ID!) { cancelLeave(id: $id) { id status decidedBy } }';
const DELETE = 'mutation($id: ID!) { deleteLeave(id: $id) }';
const UPDATE =
  'mutation($id: ID!) { updateLeave(id: $id, input: { reason: "ROV-304 edited" }) { id reason } }';

describe('ROV-304 leave authorization through GraphQL and PostgreSQL', () => {
  let app: IntegrationAppResult;
  let tenant: TestInstitute;
  let foreignTenant: TestInstitute;
  const actors: Actor[] = [];
  let admin: Actor;
  let clerk: Actor;
  let subjectTeacher: Actor;
  let classTeacher: Actor;
  let studentA1: Actor;
  let studentA2: Actor;
  let studentB: Actor;
  let parentOfA1: Actor;
  let foreignAdmin: Actor;
  let foreignStudent: Actor;
  const ids = {
    leaveA1: '',
    leaveA2: '',
    leaveB: '',
    leaveSubject: '',
    leaveClassTeacher: '',
    leaveForeign: '',
    leaveA1ToApprove: '',
    leaveA2ToUpdate: '',
    leaveBToReject: '',
    leaveA2ToDelete: '',
    leaveA1ToWithdraw: '',
    leaveA1ApprovedKept: '',
    leaveA2KeptFromA1: '',
    leaveSubjectToWithdraw: '',
    leaveClassTeacherToWithdraw: '',
    leaveA2ApprovedToCancel: '',
    leaveA1ParentWithdraws: '',
    leaveA1ApprovedParentKept: '',
    leaveBClerkKept: '',
    leaveBApprovedAdminCancels: '',
  };

  async function actor(role: DefaultRole, institute = tenant): Promise<Actor> {
    const record = await createTestTeacher(app.db, institute.tenantId);
    await withAdmin(app.db, mkAdminCtx(CTX), async (tx) => {
      await tx
        .update(roles)
        .set({ abilities: DEFAULT_ROLE_ABILITIES[role] })
        .where(eq(roles.id, record.roleId));
      await tx
        .update(memberships)
        .set({ abilities: [] })
        .where(eq(memberships.id, record.membershipId));
    });
    const result = {
      ...record,
      token: createInstituteToken({
        sub: record.userId,
        membershipId: record.membershipId,
        roleId: record.roleId,
        tenantId: institute.tenantId,
      }),
    };
    actors.push(result);
    return result;
  }

  async function section(
    tx: DrizzleDB,
    scope: { yearId: string; standardId: string },
    name: string,
    classTeacherId: string | null,
    enrolled: Actor[],
  ) {
    const [row] = await tx
      .insert(sections)
      .values({
        tenantId: tenant.tenantId,
        academicYearId: scope.yearId,
        standardId: scope.standardId,
        name: { en: name },
        displayLabel: `Class 6-${name}`,
        classTeacherId,
        ...by,
      })
      .returning();
    for (const person of enrolled) {
      await tx.insert(userProfiles).values({
        ...by,
        userId: person.userId,
        firstName: { en: `Student ${name}` },
        gender: Gender.MALE,
      });
      await tx.insert(tenantUserProfiles).values({
        tenantId: tenant.tenantId,
        ...by,
        userId: person.userId,
        firstName: { en: `Student ${name}` },
        gender: Gender.MALE,
      });
      const [profile] = await tx
        .insert(studentProfiles)
        .values({
          tenantId: tenant.tenantId,
          userId: person.userId,
          membershipId: person.membershipId,
          admissionNumber: `ROV304-${name}-${person.membershipId.slice(-4)}`,
          admissionDate: '2025-04-01',
          ...by,
        })
        .returning();
      await tx.insert(studentAcademics).values({
        tenantId: tenant.tenantId,
        studentProfileId: profile.id,
        academicYearId: scope.yearId,
        standardId: scope.standardId,
        sectionId: row.id,
        ...by,
      });
    }
    return row.id;
  }

  async function insertLeave(
    tx: DrizzleDB,
    tenantId: string,
    person: Actor,
    reason: string,
    status: 'PENDING' | 'APPROVED' = 'PENDING',
  ) {
    const [row] = await tx
      .insert(leaves)
      .values({
        tenantId,
        userId: person.membershipId,
        startDate: DAY,
        endDate: DAY,
        type: 'CASUAL',
        reason,
        status,
        ...by,
      })
      .returning({ id: leaves.id });
    return row.id;
  }

  beforeAll(async () => {
    assert.equal(new URL(process.env.DATABASE_URL_TEST ?? '').pathname, '/roviq_test');
    app = await createIntegrationApp({ modules: [AppModule] });
    tenant = await createTestInstitute(app.db);
    foreignTenant = await createTestInstitute(app.db);
    admin = await actor('institute_admin');
    clerk = await actor('admin_clerk');
    subjectTeacher = await actor('subject_teacher');
    classTeacher = await actor('class_teacher');
    studentA1 = await actor('student');
    studentA2 = await actor('student');
    studentB = await actor('student');
    parentOfA1 = await actor('parent');
    foreignAdmin = await actor('institute_admin', foreignTenant);
    foreignStudent = await actor('student', foreignTenant);

    await withAdmin(app.db, mkAdminCtx(CTX), async (tx) => {
      const [year] = await tx
        .insert(academicYears)
        .values({
          tenantId: tenant.tenantId,
          label: '2026-27',
          startDate: '2026-04-01',
          endDate: '2027-03-31',
          isActive: true,
          status: 'ACTIVE',
          ...by,
        })
        .returning();
      const [standard] = await tx
        .insert(standards)
        .values({
          tenantId: tenant.tenantId,
          academicYearId: year.id,
          name: { en: 'Class 6' },
          numericOrder: 6,
          ...by,
        })
        .returning();
      const scope = { yearId: year.id, standardId: standard.id };
      await section(tx, scope, 'A', classTeacher.membershipId, [studentA1, studentA2]);
      await section(tx, scope, 'B', null, [studentB]);

      const [childProfile] = await tx
        .select({ id: studentProfiles.id })
        .from(studentProfiles)
        .where(eq(studentProfiles.membershipId, studentA1.membershipId));
      await tx.insert(userProfiles).values({
        ...by,
        userId: parentOfA1.userId,
        firstName: { en: 'Parent' },
      });
      await tx.insert(tenantUserProfiles).values({
        tenantId: tenant.tenantId,
        ...by,
        userId: parentOfA1.userId,
        firstName: { en: 'Parent' },
      });
      const [guardian] = await tx
        .insert(guardianProfiles)
        .values({
          tenantId: tenant.tenantId,
          userId: parentOfA1.userId,
          membershipId: parentOfA1.membershipId,
          ...by,
        })
        .returning();
      await tx.insert(studentGuardianLinks).values({
        ...by,
        tenantId: tenant.tenantId,
        guardianProfileId: guardian.id,
        studentProfileId: childProfile.id,
        relationship: GuardianRelationship.FATHER,
      });

      // The class teacher is left without a profile on purpose (ROV-312).
      await tx.insert(userProfiles).values({
        ...by,
        userId: subjectTeacher.userId,
        firstName: { en: 'Meera', hi: 'मीरा' },
        lastName: { en: 'Iyer' },
        gender: Gender.FEMALE,
      });
      await tx.insert(tenantUserProfiles).values({
        tenantId: tenant.tenantId,
        ...by,
        userId: subjectTeacher.userId,
        firstName: { en: 'Meera', hi: 'मीरा' },
        lastName: { en: 'Iyer' },
        gender: Gender.FEMALE,
      });

      const t = tenant.tenantId;
      ids.leaveA1 = await insertLeave(tx, t, studentA1, 'A1 read');
      ids.leaveA2 = await insertLeave(tx, t, studentA2, 'A2 read');
      ids.leaveB = await insertLeave(tx, t, studentB, 'B read');
      ids.leaveSubject = await insertLeave(tx, t, subjectTeacher, 'subject teacher read');
      ids.leaveClassTeacher = await insertLeave(tx, t, classTeacher, 'class teacher read');
      ids.leaveA1ToApprove = await insertLeave(tx, t, studentA1, 'A1 approve');
      ids.leaveA2ToUpdate = await insertLeave(tx, t, studentA2, 'A2 update');
      ids.leaveBToReject = await insertLeave(tx, t, studentB, 'B reject');
      ids.leaveA2ToDelete = await insertLeave(tx, t, studentA2, 'A2 delete');
      ids.leaveForeign = await insertLeave(tx, foreignTenant.tenantId, foreignStudent, 'foreign');
      ids.leaveA1ToWithdraw = await insertLeave(tx, t, studentA1, 'A1 withdraw');
      ids.leaveA1ApprovedKept = await insertLeave(tx, t, studentA1, 'A1 approved', 'APPROVED');
      ids.leaveA2KeptFromA1 = await insertLeave(tx, t, studentA2, 'A2 kept from A1');
      ids.leaveSubjectToWithdraw = await insertLeave(tx, t, subjectTeacher, 'subject withdraw');
      ids.leaveClassTeacherToWithdraw = await insertLeave(tx, t, classTeacher, 'class withdraw');
      ids.leaveA2ApprovedToCancel = await insertLeave(tx, t, studentA2, 'A2 approved', 'APPROVED');
      ids.leaveA1ParentWithdraws = await insertLeave(tx, t, studentA1, 'A1 parent withdraws');
      ids.leaveA1ApprovedParentKept = await insertLeave(
        tx,
        t,
        studentA1,
        'A1 approved parent',
        'APPROVED',
      );
      ids.leaveBClerkKept = await insertLeave(tx, t, studentB, 'B clerk kept');
      ids.leaveBApprovedAdminCancels = await insertLeave(tx, t, studentB, 'B approved', 'APPROVED');
    });
  }, 60_000);

  afterAll(async () => {
    if (!app) return;
    if (tenant && foreignTenant) {
      await withAdmin(app.db, mkAdminCtx(CTX), async (tx) => {
        const tenantIds = [tenant.tenantId, foreignTenant.tenantId];
        await tx.delete(leaves).where(inArray(leaves.tenantId, tenantIds));
        await tx
          .delete(studentGuardianLinks)
          .where(inArray(studentGuardianLinks.tenantId, tenantIds));
        await tx.delete(guardianProfiles).where(inArray(guardianProfiles.tenantId, tenantIds));
        await tx.delete(studentAcademics).where(inArray(studentAcademics.tenantId, tenantIds));
        await tx.delete(studentProfiles).where(inArray(studentProfiles.tenantId, tenantIds));
        await tx.delete(sections).where(inArray(sections.tenantId, tenantIds));
        await tx.delete(standards).where(inArray(standards.tenantId, tenantIds));
        await tx.delete(academicYears).where(inArray(academicYears.tenantId, tenantIds));
        await tx.delete(tenantUserProfiles).where(
          inArray(
            tenantUserProfiles.userId,
            actors.map((entry) => entry.userId),
          ),
        );
        await tx.delete(userProfiles).where(
          inArray(
            userProfiles.userId,
            actors.map((entry) => entry.userId),
          ),
        );
      });
    }
    for (const entry of actors.reverse()) await cleanupTestTeacher(app.db, entry);
    if (tenant) await cleanupTestInstitute(app.db, tenant);
    if (foreignTenant) await cleanupTestInstitute(app.db, foreignTenant);
    await app.close();
  });

  async function query<T>(person: Actor, source: string, variables: Record<string, unknown> = {}) {
    const response = await gqlRequest<T>(app.httpServer, {
      token: person.token,
      query: source,
      variables,
    });
    expect(response.errors).toBeUndefined();
    assert(response.data);
    return response.data;
  }

  async function errorCodes(person: Actor, source: string, variables: Record<string, unknown>) {
    const response = await gqlRequest(app.httpServer, {
      token: person.token,
      query: source,
      variables,
    });
    return response.errors?.map((error) => error.extensions?.code);
  }

  async function listedIds(person: Actor) {
    const data = await query<{ leaves: { id: string }[] }>(person, LIST);
    return data.leaves.map((row) => row.id).sort();
  }

  async function stored(id: string): Promise<StoredLeave> {
    const rows = await withAdmin(app.db, mkAdminCtx(CTX), (tx) =>
      tx
        .select({
          userId: leaves.userId,
          status: leaves.status,
          decidedBy: leaves.decidedBy,
          deletedAt: leaves.deletedAt,
        })
        .from(leaves)
        .where(eq(leaves.id, id)),
    );
    assert.equal(rows.length, 1);
    return rows[0];
  }

  async function liveLeaveIds(tenantId: string, people?: Actor[]) {
    const rows = await withAdmin(app.db, mkAdminCtx(CTX), (tx) =>
      tx
        .select({ id: leaves.id })
        .from(leaves)
        .where(
          and(
            eq(leaves.tenantId, tenantId),
            isNull(leaves.deletedAt),
            people
              ? inArray(
                  leaves.userId,
                  people.map((person) => person.membershipId),
                )
              : undefined,
          ),
        ),
    );
    return rows.map((row) => row.id).sort();
  }

  async function leaveCountFor(person: Actor) {
    const rows = await withAdmin(app.db, mkAdminCtx(CTX), (tx) =>
      tx.select({ id: leaves.id }).from(leaves).where(eq(leaves.userId, person.membershipId)),
    );
    return rows.length;
  }

  it('should show a student only their own leaves', async () => {
    const own = await listedIds(studentA1);
    expect(own).toEqual(await liveLeaveIds(tenant.tenantId, [studentA1]));
    expect(own).toContain(ids.leaveA1);
    expect(await errorCodes(studentA1, ONE, { id: ids.leaveA2 })).toEqual(['LEAVE_NOT_FOUND']);
    const data = await query<{ leave: { id: string; userId: string } }>(studentA1, ONE, {
      id: ids.leaveA1,
    });
    expect(data.leave).toEqual({ id: ids.leaveA1, userId: studentA1.membershipId });
  });

  it('should let a student file a leave only for their own membership', async () => {
    const before = {
      a1: await leaveCountFor(studentA1),
      foreign: await leaveCountFor(foreignStudent),
    };
    const data = await query<{ applyLeave: { id: string; userId: string; status: string } }>(
      studentA2,
      APPLY,
      { u: studentA2.membershipId },
    );
    expect(data.applyLeave.userId).toBe(studentA2.membershipId);
    expect(data.applyLeave.status).toBe('PENDING');
    expect(await stored(data.applyLeave.id)).toEqual({
      userId: studentA2.membershipId,
      status: 'PENDING',
      decidedBy: null,
      deletedAt: null,
    });

    expect(await errorCodes(studentA2, APPLY, { u: studentA1.membershipId })).toEqual([
      'FORBIDDEN',
    ]);
    expect(await errorCodes(studentA2, APPLY, { u: foreignStudent.membershipId })).toEqual([
      'FORBIDDEN',
    ]);
    expect(await errorCodes(studentA2, APPLY, { u: randomUUID() })).toEqual(['FORBIDDEN']);
    expect(await leaveCountFor(studentA1)).toBe(before.a1);
    expect(await leaveCountFor(foreignStudent)).toBe(before.foreign);
  });

  it('should keep a subject teacher to their own leaves without decision rights', async () => {
    expect(await listedIds(subjectTeacher)).toEqual(
      [ids.leaveSubject, ids.leaveSubjectToWithdraw].sort(),
    );
    // Subject teachers have no update rule at all, so the ability guard refuses before any lookup.
    expect(await errorCodes(subjectTeacher, APPROVE, { id: ids.leaveA1 })).toEqual(['FORBIDDEN']);
    // They may withdraw, so cancelling passes the guard and meets the read rules instead.
    expect(await errorCodes(subjectTeacher, CANCEL, { id: ids.leaveA1 })).toEqual([
      'LEAVE_NOT_FOUND',
    ]);
    expect(await errorCodes(subjectTeacher, APPROVE, { id: ids.leaveSubject })).toEqual([
      'FORBIDDEN',
    ]);
    expect(await errorCodes(subjectTeacher, ONE, { id: ids.leaveA1 })).toEqual(['LEAVE_NOT_FOUND']);
    expect((await stored(ids.leaveA1)).status).toBe('PENDING');
    expect((await stored(ids.leaveSubject)).status).toBe('PENDING');
  });

  it('should let a class teacher see and decide leaves of their section students only', async () => {
    const listed = await listedIds(classTeacher);
    expect(listed).toEqual(
      await liveLeaveIds(tenant.tenantId, [studentA1, studentA2, classTeacher]),
    );
    expect(listed).toContain(ids.leaveClassTeacher);
    expect(listed).not.toContain(ids.leaveB);
    expect(listed).not.toContain(ids.leaveSubject);

    const data = await query<{
      approveLeave: { id: string; status: string; decidedBy: string };
    }>(classTeacher, APPROVE, { id: ids.leaveA1ToApprove });
    expect(data.approveLeave).toEqual({
      id: ids.leaveA1ToApprove,
      status: 'APPROVED',
      decidedBy: classTeacher.membershipId,
    });
    expect(await stored(ids.leaveA1ToApprove)).toEqual({
      userId: studentA1.membershipId,
      status: 'APPROVED',
      decidedBy: classTeacher.membershipId,
      deletedAt: null,
    });

    const updated = await query<{ updateLeave: { id: string; reason: string } }>(
      classTeacher,
      UPDATE,
      { id: ids.leaveA2ToUpdate },
    );
    expect(updated.updateLeave).toEqual({ id: ids.leaveA2ToUpdate, reason: 'ROV-304 edited' });
  });

  it('should answer LEAVE_NOT_FOUND to a class teacher for leaves outside their sections', async () => {
    for (const source of [APPROVE, REJECT, CANCEL, DELETE, UPDATE, ONE]) {
      expect(await errorCodes(classTeacher, source, { id: ids.leaveB })).toEqual([
        'LEAVE_NOT_FOUND',
      ]);
      expect(await errorCodes(classTeacher, source, { id: ids.leaveForeign })).toEqual([
        'LEAVE_NOT_FOUND',
      ]);
    }
    expect(await stored(ids.leaveB)).toEqual({
      userId: studentB.membershipId,
      status: 'PENDING',
      decidedBy: null,
      deletedAt: null,
    });
  });

  it('should answer FORBIDDEN to a class teacher deciding a leave they may only read', async () => {
    // Not CANCEL: a pending leave of their own is theirs to withdraw.
    for (const source of [APPROVE, REJECT, DELETE, UPDATE]) {
      expect(await errorCodes(classTeacher, source, { id: ids.leaveClassTeacher })).toEqual([
        'FORBIDDEN',
      ]);
    }
    expect(await stored(ids.leaveClassTeacher)).toEqual({
      userId: classTeacher.membershipId,
      status: 'PENDING',
      decidedBy: null,
      deletedAt: null,
    });
  });

  it('should show a parent only the leaves of their linked child', async () => {
    expect(await listedIds(parentOfA1)).toEqual(await liveLeaveIds(tenant.tenantId, [studentA1]));
    expect(await errorCodes(parentOfA1, ONE, { id: ids.leaveA2 })).toEqual(['LEAVE_NOT_FOUND']);
  });

  it('should let the clerk and the admin read every leave of their institute only', async () => {
    for (const person of [clerk, admin]) {
      const listed = await listedIds(person);
      expect(listed).toEqual(await liveLeaveIds(tenant.tenantId));
      for (const id of [
        ids.leaveA1,
        ids.leaveA2,
        ids.leaveB,
        ids.leaveSubject,
        ids.leaveClassTeacher,
      ]) {
        expect(listed).toContain(id);
      }
      expect(listed).not.toContain(ids.leaveForeign);
    }
    expect(await errorCodes(clerk, APPROVE, { id: ids.leaveB })).toEqual(['FORBIDDEN']);
    expect((await stored(ids.leaveB)).status).toBe('PENDING');
  });

  it('should name the applicant of each leave: a student with admission number, staff without', async () => {
    const data = await query<{
      leaves: {
        id: string;
        applicant: {
          firstName: Record<string, string>;
          lastName: Record<string, string> | null;
          admissionNumber: string | null;
        } | null;
      }[];
    }>(admin, 'query { leaves { id applicant { firstName lastName admissionNumber } } }');
    const applicantOf = (id: string) => data.leaves.find((row) => row.id === id)?.applicant;

    expect(applicantOf(ids.leaveA1)).toEqual({
      firstName: { en: 'Student A' },
      lastName: null,
      admissionNumber: `ROV304-A-${studentA1.membershipId.slice(-4)}`,
    });
    expect(applicantOf(ids.leaveSubject)).toEqual({
      firstName: { en: 'Meera', hi: 'मीरा' },
      lastName: { en: 'Iyer' },
      admissionNumber: null,
    });
    // No profile row: null, never another person's name.
    expect(applicantOf(ids.leaveClassTeacher)).toBeNull();
  });

  it('should refuse the clerk a cancel', async () => {
    expect(await errorCodes(clerk, CANCEL, { id: ids.leaveBClerkKept })).toEqual(['FORBIDDEN']);
    expect(await stored(ids.leaveBClerkKept)).toEqual({
      userId: studentB.membershipId,
      status: 'PENDING',
      decidedBy: null,
      deletedAt: null,
    });
  });

  it('should let the admin cancel an approved leave', async () => {
    const data = await query<{ cancelLeave: { id: string; status: string; decidedBy: string } }>(
      admin,
      CANCEL,
      { id: ids.leaveBApprovedAdminCancels },
    );
    expect(data.cancelLeave).toEqual({
      id: ids.leaveBApprovedAdminCancels,
      status: 'CANCELLED',
      decidedBy: admin.membershipId,
    });
    expect(await stored(ids.leaveBApprovedAdminCancels)).toEqual({
      userId: studentB.membershipId,
      status: 'CANCELLED',
      decidedBy: admin.membershipId,
      deletedAt: null,
    });
  });

  it('should let the admin reject and delete a leave, recording the admin as decider', async () => {
    const data = await query<{ rejectLeave: { id: string; status: string; decidedBy: string } }>(
      admin,
      REJECT,
      { id: ids.leaveBToReject },
    );
    expect(data.rejectLeave).toEqual({
      id: ids.leaveBToReject,
      status: 'REJECTED',
      decidedBy: admin.membershipId,
    });
    expect(await stored(ids.leaveBToReject)).toEqual({
      userId: studentB.membershipId,
      status: 'REJECTED',
      decidedBy: admin.membershipId,
      deletedAt: null,
    });

    const deleted = await query<{ deleteLeave: boolean }>(admin, DELETE, {
      id: ids.leaveA2ToDelete,
    });
    expect(deleted.deleteLeave).toBe(true);
    const row = await stored(ids.leaveA2ToDelete);
    expect(row.deletedAt).toBeInstanceOf(Date);
    expect(await errorCodes(admin, ONE, { id: ids.leaveA2ToDelete })).toEqual(['LEAVE_NOT_FOUND']);
  });

  describe('withdraw', () => {
    async function withdraw(person: Actor, id: string) {
      const data = await query<{
        cancelLeave: { id: string; status: string; decidedBy: string };
      }>(person, CANCEL, { id });
      return data.cancelLeave;
    }

    it('should let a student withdraw their own pending leave', async () => {
      expect(await withdraw(studentA1, ids.leaveA1ToWithdraw)).toEqual({
        id: ids.leaveA1ToWithdraw,
        status: 'CANCELLED',
        decidedBy: studentA1.membershipId,
      });
      expect(await stored(ids.leaveA1ToWithdraw)).toEqual({
        userId: studentA1.membershipId,
        status: 'CANCELLED',
        decidedBy: studentA1.membershipId,
        deletedAt: null,
      });
    });

    it('should refuse a student withdrawing their own approved leave', async () => {
      expect(await errorCodes(studentA1, CANCEL, { id: ids.leaveA1ApprovedKept })).toEqual([
        'FORBIDDEN',
      ]);
      expect(await stored(ids.leaveA1ApprovedKept)).toEqual({
        userId: studentA1.membershipId,
        status: 'APPROVED',
        decidedBy: null,
        deletedAt: null,
      });
    });

    it('should answer LEAVE_NOT_FOUND to a student withdrawing another student’s leave', async () => {
      expect(await errorCodes(studentA1, CANCEL, { id: ids.leaveA2KeptFromA1 })).toEqual([
        'LEAVE_NOT_FOUND',
      ]);
      expect(await stored(ids.leaveA2KeptFromA1)).toEqual({
        userId: studentA2.membershipId,
        status: 'PENDING',
        decidedBy: null,
        deletedAt: null,
      });
    });

    it('should let a subject teacher withdraw, but not approve, their own pending leave', async () => {
      expect(await errorCodes(subjectTeacher, APPROVE, { id: ids.leaveSubjectToWithdraw })).toEqual(
        ['FORBIDDEN'],
      );
      expect((await stored(ids.leaveSubjectToWithdraw)).status).toBe('PENDING');

      expect(await withdraw(subjectTeacher, ids.leaveSubjectToWithdraw)).toEqual({
        id: ids.leaveSubjectToWithdraw,
        status: 'CANCELLED',
        decidedBy: subjectTeacher.membershipId,
      });
      expect(await stored(ids.leaveSubjectToWithdraw)).toEqual({
        userId: subjectTeacher.membershipId,
        status: 'CANCELLED',
        decidedBy: subjectTeacher.membershipId,
        deletedAt: null,
      });
    });

    it('should let a class teacher withdraw their own pending leave', async () => {
      expect(await withdraw(classTeacher, ids.leaveClassTeacherToWithdraw)).toEqual({
        id: ids.leaveClassTeacherToWithdraw,
        status: 'CANCELLED',
        decidedBy: classTeacher.membershipId,
      });
      expect(await stored(ids.leaveClassTeacherToWithdraw)).toEqual({
        userId: classTeacher.membershipId,
        status: 'CANCELLED',
        decidedBy: classTeacher.membershipId,
        deletedAt: null,
      });
    });

    it('should let a class teacher cancel an approved leave of a section student', async () => {
      expect(await withdraw(classTeacher, ids.leaveA2ApprovedToCancel)).toEqual({
        id: ids.leaveA2ApprovedToCancel,
        status: 'CANCELLED',
        decidedBy: classTeacher.membershipId,
      });
      expect(await stored(ids.leaveA2ApprovedToCancel)).toEqual({
        userId: studentA2.membershipId,
        status: 'CANCELLED',
        decidedBy: classTeacher.membershipId,
        deletedAt: null,
      });
    });
  });

  describe('guardian', () => {
    it('should let a parent apply for their linked child', async () => {
      const data = await query<{ applyLeave: { id: string; userId: string; status: string } }>(
        parentOfA1,
        APPLY,
        { u: studentA1.membershipId },
      );
      expect(data.applyLeave.userId).toBe(studentA1.membershipId);
      expect(data.applyLeave.status).toBe('PENDING');
      expect(await stored(data.applyLeave.id)).toEqual({
        userId: studentA1.membershipId,
        status: 'PENDING',
        decidedBy: null,
        deletedAt: null,
      });
    });

    it('should refuse a parent applying for a student who is not their child', async () => {
      const before = await leaveCountFor(studentB);
      expect(await errorCodes(parentOfA1, APPLY, { u: studentB.membershipId })).toEqual([
        'FORBIDDEN',
      ]);
      expect(await errorCodes(parentOfA1, APPLY, { u: parentOfA1.membershipId })).toEqual([
        'FORBIDDEN',
      ]);
      expect(await leaveCountFor(studentB)).toBe(before);
      expect(await leaveCountFor(parentOfA1)).toBe(0);
    });

    it('should refuse a parent approving their child’s leave', async () => {
      expect(await errorCodes(parentOfA1, APPROVE, { id: ids.leaveA1ParentWithdraws })).toEqual([
        'FORBIDDEN',
      ]);
      expect((await stored(ids.leaveA1ParentWithdraws)).status).toBe('PENDING');
    });

    it('should let a parent withdraw their child’s pending leave', async () => {
      const data = await query<{
        cancelLeave: { id: string; status: string; decidedBy: string };
      }>(parentOfA1, CANCEL, { id: ids.leaveA1ParentWithdraws });
      expect(data.cancelLeave).toEqual({
        id: ids.leaveA1ParentWithdraws,
        status: 'CANCELLED',
        decidedBy: parentOfA1.membershipId,
      });
      expect(await stored(ids.leaveA1ParentWithdraws)).toEqual({
        userId: studentA1.membershipId,
        status: 'CANCELLED',
        decidedBy: parentOfA1.membershipId,
        deletedAt: null,
      });
    });

    it('should refuse a parent withdrawing their child’s approved leave', async () => {
      expect(await errorCodes(parentOfA1, CANCEL, { id: ids.leaveA1ApprovedParentKept })).toEqual([
        'FORBIDDEN',
      ]);
      expect(await stored(ids.leaveA1ApprovedParentKept)).toEqual({
        userId: studentA1.membershipId,
        status: 'APPROVED',
        decidedBy: null,
        deletedAt: null,
      });
    });
  });

  it('should keep another institute from reading these leaves', async () => {
    expect(await errorCodes(foreignAdmin, ONE, { id: ids.leaveA1 })).toEqual(['LEAVE_NOT_FOUND']);
    expect(await errorCodes(foreignAdmin, APPROVE, { id: ids.leaveA1 })).toEqual([
      'LEAVE_NOT_FOUND',
    ]);
    const listed = await listedIds(foreignAdmin);
    expect(listed).toEqual([ids.leaveForeign]);
    expect(await errorCodes(foreignAdmin, APPLY, { u: studentA1.membershipId })).toEqual([
      'FORBIDDEN',
    ]);
  });

  it('should reject a platform-scope token', async () => {
    const response = await gqlRequest(app.httpServer, {
      token: createPlatformToken({
        sub: admin.userId,
        membershipId: admin.membershipId,
        roleId: admin.roleId,
      }),
      query: LIST,
      variables: {},
    });
    expect(response.errors?.map((error) => error.extensions?.code)).toEqual(['FORBIDDEN']);
  });
});
