/**
 * ROV-316 — the gateway consumes its own JetStream events. Activating an academic year emits
 * `ACADEMIC_YEAR.activated`; the gateway's consumer gives continuing students a row in the new
 * year, which becomes readable through GraphQL.
 *
 * Activation is forward-only and changes an institute's active year for good, so this runs in
 * an institute it creates. Handler rules and tenant isolation are covered by
 * `gateway-event-handlers.integration.spec.ts`.
 */
import assert from 'node:assert';
import { Gender, SocialCategory } from '@roviq/common-types';
import { beforeAll, describe, expect, it, vi } from 'vitest';
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
  academicYearId: string;
  standardId: string | null;
  sectionId: string | null;
}

/** A fresh institute's first admin, past the forced password change. */
async function loginAsFreshInstituteAdmin(): Promise<string> {
  const adminToken = (await loginAsPlatformAdmin()).accessToken;
  const firstAdmin = firstAdminInput();
  const created = await gql<{ adminCreateInstitute: { id: string } }>(
    `mutation ($input: AdminCreateInstituteInput!) { adminCreateInstitute(input: $input) { id } }`,
    {
      input: {
        firstAdmin,
        name: { en: 'E2E Year Rollover' },
        slug: `e2e-rollover-${Date.now()}`,
        type: 'COACHING',
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

describe('Gateway event consumers E2E', () => {
  let token: string;

  async function createStandardWithSection(academicYearId: string): Promise<{
    standardId: string;
    sectionId: string;
  }> {
    const std = await gql<{ createStandard: { id: string } }>(
      `mutation ($input: CreateStandardInput!) { createStandard(input: $input) { id } }`,
      { input: { academicYearId, name: { en: 'Rollover Class' }, numericOrder: 90 } },
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

  beforeAll(async () => {
    token = await loginAsFreshInstituteAdmin();
  }, 90_000);

  it('activating a year gives the previous year’s students a row in the new year', async () => {
    const active = await gql<{ activeAcademicYear: { id: string } }>(
      `{ activeAcademicYear { id } }`,
      undefined,
      token,
    );
    expect(active.errors).toBeUndefined();
    const previousYearId = active.data?.activeAcademicYear.id;
    assert(previousYearId);
    const previous = await createStandardWithSection(previousYearId);

    const student = await gql<{ createStudent: { id: string } }>(
      `mutation ($input: CreateStudentInput!) { createStudent(input: $input) { id } }`,
      {
        input: {
          firstName: { en: 'Ananya' },
          lastName: { en: 'Iyer' },
          gender: Gender.FEMALE,
          dateOfBirth: '2014-08-12',
          academicYearId: previousYearId,
          standardId: previous.standardId,
          sectionId: previous.sectionId,
          socialCategory: SocialCategory.GENERAL,
        },
      },
      token,
    );
    expect(student.errors).toBeUndefined();
    const studentProfileId = student.data?.createStudent.id;
    assert(studentProfileId);

    const nextYear = await gql<{ createAcademicYear: { id: string } }>(
      `mutation ($input: CreateAcademicYearInput!) { createAcademicYear(input: $input) { id } }`,
      { input: { label: '2040-41', startDate: '2040-04-01', endDate: '2041-03-31' } },
      token,
    );
    expect(nextYear.errors).toBeUndefined();
    const nextYearId = nextYear.data?.createAcademicYear.id;
    assert(nextYearId);
    const next = await createStandardWithSection(nextYearId);

    const activated = await gql<{ activateAcademicYear: { isActive: boolean } }>(
      `mutation ($id: ID!) { activateAcademicYear(id: $id) { isActive } }`,
      { id: nextYearId },
      token,
    );
    expect(activated.errors).toBeUndefined();
    expect(activated.data?.activateAcademicYear.isActive).toBe(true);

    const nextYearRow = await vi.waitFor(
      async () => {
        const history = await gql<{ listStudentAcademics: AcademicHistoryRow[] }>(
          `query ($id: ID!) {
            listStudentAcademics(studentProfileId: $id) { academicYearId standardId sectionId }
          }`,
          { id: studentProfileId },
          token,
        );
        expect(history.errors).toBeUndefined();
        const row = history.data?.listStudentAcademics.find((r) => r.academicYearId === nextYearId);
        assert(row, 'the new-year row has not been created yet');
        return row;
      },
      { timeout: 10_000, interval: 250 },
    );

    expect(nextYearRow).toEqual({
      academicYearId: nextYearId,
      standardId: next.standardId,
      sectionId: next.sectionId,
    });
  });
});
