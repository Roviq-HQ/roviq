/**
 * ROV-315: a staff member created with an email receives the institute's welcome in Mailpit,
 * signs in with the temporary password, sets their own, and reaches the institute. Resend,
 * cross-institute refusal and the status fields are covered by
 * sign-in-details.integration.spec.ts.
 */
import assert from 'node:assert';
import { EmploymentType, Gender } from '@roviq/common-types';
import { describe, expect, it } from 'vitest';
import { loginAsInstituteAdmin } from './helpers/auth';
import { gql } from './helpers/gql-client';
import { waitForEmail } from './helpers/mailpit';

const NEW_PASSWORD = 'Staff-Own-Pass-9';

const INSTITUTE_LOGIN = `mutation ($u: String!, $p: String!) {
  instituteLogin(username: $u, password: $p) { accessToken }
}`;

interface InstituteLogin {
  instituteLogin: { accessToken: string | null };
}

function lineValue(text: string, label: string): string {
  const match = new RegExp(`^${label}: (\\S+)$`, 'm').exec(text);
  if (!match) throw new Error(`The welcome email carries no "${label}" line`);
  return match[1];
}

describe('Staff sign-in details E2E', () => {
  it('lets a new staff member sign in with the emailed details and set a password', async () => {
    const admin = await loginAsInstituteAdmin();
    const email = `rov315-staff-${Date.now()}@example.in`;
    const created = await gql<{ createStaffMember: { id: string } }>(
      `mutation ($input: CreateStaffInput!) { createStaffMember(input: $input) { id } }`,
      {
        input: {
          firstName: { en: 'Kiran' },
          lastName: { en: 'Das' },
          gender: Gender.FEMALE,
          designation: 'TGT Mathematics',
          employmentType: EmploymentType.REGULAR,
          email,
        },
      },
      admin.accessToken,
    );
    expect(created.errors).toBeUndefined();
    assert(created.data);

    const welcome = await waitForEmail(email, 'Roviq sign-in details for');
    const username = lineValue(welcome.text, 'Username');
    const tempPassword = lineValue(welcome.text, 'Temporary password');

    const first = await gql<InstituteLogin>(INSTITUTE_LOGIN, { u: username, p: tempPassword });
    expect(first.errors).toBeUndefined();
    const token = first.data?.instituteLogin.accessToken;
    assert(token);
    const blocked = await gql(`query { myInstitute { id } }`, undefined, token);
    expect(blocked.errors?.[0]?.extensions?.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = await gql<{ changePassword: boolean }>(
      `mutation ($c: String!, $n: String!) { changePassword(currentPassword: $c, newPassword: $n) }`,
      { c: tempPassword, n: NEW_PASSWORD },
      token,
    );
    expect(changed.errors).toBeUndefined();
    expect(changed.data?.changePassword).toBe(true);

    const fresh = await gql<InstituteLogin>(INSTITUTE_LOGIN, { u: username, p: NEW_PASSWORD });
    const freshToken = fresh.data?.instituteLogin.accessToken;
    assert(freshToken);
    const allowed = await gql<{ myInstitute: { id: string } }>(
      `query { myInstitute { id } }`,
      undefined,
      freshToken,
    );
    expect(allowed.errors).toBeUndefined();
    expect(allowed.data?.myInstitute.id).toBe(admin.tenantId);

    const after = await gql<{ getStaffMember: { signInStatus: string } }>(
      `query ($id: ID!) { getStaffMember(id: $id) { signInStatus } }`,
      { id: created.data.createStaffMember.id },
      admin.accessToken,
    );
    expect(after.errors).toBeUndefined();
    expect(after.data?.getStaffMember.signInStatus).toBe('SIGNED_IN');
  });
});
