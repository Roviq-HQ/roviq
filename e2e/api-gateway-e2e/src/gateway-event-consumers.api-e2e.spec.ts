/**
 * ROV-316 / ROV-321 — the gateway consumes its own JetStream events. Activating an academic year
 * emits `ACADEMIC_YEAR.activated`; the gateway's consumer gives continuing students a row in the
 * new year by the year-end result recorded with `setPromotionDecisions`, which becomes readable
 * through GraphQL.
 *
 * Activation is forward-only and changes an institute's active year for good, so each case runs
 * in an institute it creates. Every rule, tenant isolation and CASL refusal are covered by
 * `gateway-event-handlers.integration.spec.ts` and `year-end-promotion.integration.spec.ts`.
 */
import assert from 'node:assert';
import { Gender, InstituteType, PromotionStatus, SocialCategory } from '@roviq/common-types';
import { describe, expect, it, vi } from 'vitest';
import { loginAsPlatformAdmin } from './helpers/auth';
import { firstAdminInput } from './helpers/first-admin';
import { gql } from './helpers/gql-client';
import { waitForEmail } from './helpers/mailpit';
import { waitForSetupComplete } from './helpers/wait-for-setup-complete';

const NEW_PASSWORD = 'Rollover-Admin-Pass-9';

const INSTITUTE_LOGIN = `mutation ($u: String!, $p: String!) {
  instituteLogin(username: $u, password: $p) { accessToken }
}`;

interface AcademicHistoryRow {
  id: string;
  academicYearId: string;
  standardId: string | null;
  sectionId: string | null;
}

/** A fresh institute's first admin, past the forced password change. */
async function loginAsFreshInstituteAdmin(type: InstituteType): Promise<string> {
  const adminToken = (await loginAsPlatformAdmin()).accessToken;
  const firstAdmin = firstAdminInput();
  const created = await gql<{ adminCreateInstitute: { id: string } }>(
    `mutation ($input: AdminCreateInstituteInput!) { adminCreateInstitute(input: $input) { id } }`,
    {
      input: {
        firstAdmin,
        name: { en: 'E2E Year Rollover' },
        slug: `e2e-rollover-${type.toLowerCase()}-${Date.now()}`,
        type,
      },
    },
    adminToken,
  );
  expect(created.errors).toBeUndefined();
  const instituteId = created.data?.adminCreateInstitute.id;
  assert(instituteId);
  await waitForSetupComplete(instituteId, adminToken, 30_000);
  const activated = await gql(
    `mutation ($id: ID!) { adminActivateInstitute(id: $id) { status } }`,
    { id: instituteId },
    adminToken,
  );
  expect(activated.errors).toBeUndefined();

  const usersRes = await gql<{
    adminListUsers: { edges: Array<{ node: { email: string; username: string } }> };
  }>(
    `query ($tenantId: String!) {
      adminListUsers(filter: { tenantId: $tenantId, first: 10 }) { edges { node { email username } } }
    }`,
    { tenantId: instituteId },
    adminToken,
  );
  expect(usersRes.errors).toBeUndefined();
  const username = usersRes.data?.adminListUsers.edges.find(
    (edge) => edge.node.email === firstAdmin.email,
  )?.node.username;
  assert(username);
  const welcome = await waitForEmail(firstAdmin.email, 'Welcome to Roviq');
  const tempPassword = /^Temporary password: (\S+)$/m.exec(welcome.text)?.[1];
  assert(tempPassword);

  const first = await gql<{ instituteLogin: { accessToken: string } }>(INSTITUTE_LOGIN, {
    u: username,
    p: tempPassword,
  });
  const firstToken = first.data?.instituteLogin.accessToken;
  assert(firstToken);
  const changed = await gql(
    `mutation ($c: String!, $n: String!) { changePassword(currentPassword: $c, newPassword: $n) }`,
    { c: tempPassword, n: NEW_PASSWORD },
    firstToken,
  );
  expect(changed.errors).toBeUndefined();
  const fresh = await gql<{ instituteLogin: { accessToken: string } }>(INSTITUTE_LOGIN, {
    u: username,
    p: NEW_PASSWORD,
  });
  const token = fresh.data?.instituteLogin.accessToken;
  assert(token);
  return token;
}

const HISTORY = `query ($id: ID!) {
  listStudentAcademics(studentProfileId: $id) { id academicYearId standardId sectionId }
}`;

async function history(studentProfileId: string, token: string): Promise<AcademicHistoryRow[]> {
  const res = await gql<{ listStudentAcademics: AcademicHistoryRow[] }>(
    HISTORY,
    { id: studentProfileId },
    token,
  );
  expect(res.errors).toBeUndefined();
  return res.data?.listStudentAcademics ?? [];
}

async function activeYearId(token: string): Promise<string> {
  const active = await gql<{ activeAcademicYear: { id: string } }>(
    `{ activeAcademicYear { id } }`,
    undefined,
    token,
  );
  expect(active.errors).toBeUndefined();
  const id = active.data?.activeAcademicYear.id;
  assert(id);
  return id;
}

async function createNextYear(token: string): Promise<string> {
  const nextYear = await gql<{ createAcademicYear: { id: string } }>(
    `mutation ($input: CreateAcademicYearInput!) { createAcademicYear(input: $input) { id } }`,
    { input: { label: '2040-41', startDate: '2040-04-01', endDate: '2041-03-31' } },
    token,
  );
  expect(nextYear.errors).toBeUndefined();
  const id = nextYear.data?.createAcademicYear.id;
  assert(id);
  return id;
}

async function createStudentIn(
  token: string,
  placement: { academicYearId: string; standardId: string; sectionId: string },
  firstName: string,
): Promise<string> {
  const student = await gql<{ createStudent: { id: string } }>(
    `mutation ($input: CreateStudentInput!) { createStudent(input: $input) { id } }`,
    {
      input: {
        firstName: { en: firstName },
        lastName: { en: 'Iyer' },
        gender: Gender.FEMALE,
        dateOfBirth: '2014-08-12',
        ...placement,
        socialCategory: SocialCategory.GENERAL,
      },
    },
    token,
  );
  expect(student.errors).toBeUndefined();
  const id = student.data?.createStudent.id;
  assert(id);
  return id;
}

async function activate(token: string, academicYearId: string): Promise<void> {
  const activated = await gql<{ activateAcademicYear: { isActive: boolean } }>(
    `mutation ($id: ID!) { activateAcademicYear(id: $id) { isActive } }`,
    { id: academicYearId },
    token,
  );
  expect(activated.errors).toBeUndefined();
  expect(activated.data?.activateAcademicYear.isActive).toBe(true);
}

/** Bounded wait for the consumer to write the student's new-year row. */
function waitForYearRow(studentProfileId: string, academicYearId: string, token: string) {
  return vi.waitFor(
    async () => {
      const row = (await history(studentProfileId, token)).find(
        (r) => r.academicYearId === academicYearId,
      );
      assert(row, 'the new-year row has not been created yet');
      return row;
    },
    { timeout: 10_000, interval: 250 },
  );
}

async function createStandardWithSection(
  token: string,
  academicYearId: string,
  numericOrder: number,
): Promise<{
  standardId: string;
  sectionId: string;
}> {
  const std = await gql<{ createStandard: { id: string } }>(
    `mutation ($input: CreateStandardInput!) { createStandard(input: $input) { id } }`,
    { input: { academicYearId, name: { en: `Rollover Class ${numericOrder}` }, numericOrder } },
    token,
  );
  expect(std.errors).toBeUndefined();
  const standardId = std.data?.createStandard.id;
  assert(standardId);
  const sec = await gql<{ createSection: { id: string } }>(
    `mutation ($input: CreateSectionInput!) { createSection(input: $input) { id } }`,
    { input: { standardId, academicYearId, name: { en: 'R-A' }, displayLabel: 'R-A' } },
    token,
  );
  expect(sec.errors).toBeUndefined();
  const sectionId = sec.data?.createSection.id;
  assert(sectionId);
  return { standardId, sectionId };
}

describe('Gateway event consumers E2E', () => {
  it('activating a year keeps an undecided COACHING student at the same level', async () => {
    const token = await loginAsFreshInstituteAdmin(InstituteType.COACHING);
    const previousYearId = await activeYearId(token);
    const previous = await createStandardWithSection(token, previousYearId, 90);
    const studentProfileId = await createStudentIn(
      token,
      { academicYearId: previousYearId, ...previous },
      'Ananya',
    );
    const nextYearId = await createNextYear(token);
    const next = await createStandardWithSection(token, nextYearId, 90);

    await activate(token, nextYearId);

    const row = await waitForYearRow(studentProfileId, nextYearId, token);
    expect(row).toEqual({
      id: row.id,
      academicYearId: nextYearId,
      standardId: next.standardId,
      sectionId: next.sectionId,
    });
  }, 90_000);

  it('moves an undecided student up a level and keeps a DETAINED one, as the preview said', async () => {
    const token = await loginAsFreshInstituteAdmin(InstituteType.SCHOOL);
    const previousYearId = await activeYearId(token);
    const lower = await createStandardWithSection(token, previousYearId, 91);
    await createStandardWithSection(token, previousYearId, 92);
    const placement = { academicYearId: previousYearId, ...lower };
    const movingUp = await createStudentIn(token, placement, 'Kavya');
    const detained = await createStudentIn(token, placement, 'Rohan');
    const nextYearId = await createNextYear(token);
    const nextLower = await createStandardWithSection(token, nextYearId, 91);
    const nextUpper = await createStandardWithSection(token, nextYearId, 92);

    const detainedRow = (await history(detained, token)).find(
      (r) => r.academicYearId === previousYearId,
    );
    assert(detainedRow);
    const decided = await gql<{ setPromotionDecisions: number }>(
      `mutation ($input: SetPromotionDecisionsInput!) { setPromotionDecisions(input: $input) }`,
      { input: { studentAcademicIds: [detainedRow.id], status: PromotionStatus.DETAINED } },
      token,
    );
    expect(decided.errors).toBeUndefined();
    expect(decided.data?.setPromotionDecisions).toBe(1);

    const preview = await gql<{
      academicYearRolloverPreview: Record<string, number>;
    }>(
      `query ($id: ID!) {
        academicYearRolloverPreview(academicYearId: $id) {
          movingUp staying completing notCarried noClassInNewYear alreadyPlaced
        }
      }`,
      { id: nextYearId },
      token,
    );
    expect(preview.errors).toBeUndefined();
    expect(preview.data?.academicYearRolloverPreview).toEqual({
      movingUp: 1,
      staying: 1,
      completing: 0,
      notCarried: 0,
      noClassInNewYear: 0,
      alreadyPlaced: 0,
    });

    await activate(token, nextYearId);

    const up = await waitForYearRow(movingUp, nextYearId, token);
    const stayed = await waitForYearRow(detained, nextYearId, token);
    expect(up).toEqual({ id: up.id, academicYearId: nextYearId, ...nextUpper });
    expect(stayed).toEqual({ id: stayed.id, academicYearId: nextYearId, ...nextLower });
  }, 90_000);
});
