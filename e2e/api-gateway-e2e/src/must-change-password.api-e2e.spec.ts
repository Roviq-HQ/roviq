/**
 * First-login password change against the running stack: a platform admin creates an
 * institute with a first admin, setup creates that account with a temporary password and
 * emails the welcome, and the first admin's session may only read `me` and change the
 * password until it does. The temporary password is read from the welcome email in Mailpit.
 */
import assert from 'node:assert';
import { describe, expect, it } from 'vitest';
import { loginAsPlatformAdmin } from './helpers/auth';
import { firstAdminInput } from './helpers/first-admin';
import { gql } from './helpers/gql-client';
import { waitForEmail } from './helpers/mailpit';
import { waitForSetupComplete } from './helpers/wait-for-setup-complete';

const NEW_PASSWORD = 'First-Admin-Pass-9';

const INSTITUTE_LOGIN = `mutation ($u: String!, $p: String!) {
  instituteLogin(username: $u, password: $p) { accessToken refreshToken }
}`;

interface InstituteLogin {
  instituteLogin: { accessToken: string | null; refreshToken: string | null };
}

function tempPasswordFrom(text: string): string {
  const match = /^Temporary password: (\S+)$/m.exec(text);
  if (!match) throw new Error('The welcome email carries no temporary password');
  return match[1];
}

describe('First-login password change E2E', () => {
  it('blocks the new first admin until they change the temporary password', async () => {
    const adminToken = (await loginAsPlatformAdmin()).accessToken;
    const firstAdmin = firstAdminInput();
    const created = await gql<{ adminCreateInstitute: { id: string } }>(
      `mutation ($input: AdminCreateInstituteInput!) { adminCreateInstitute(input: $input) { id } }`,
      {
        input: {
          firstAdmin,
          name: { en: 'E2E Forced Password Change' },
          slug: `e2e-must-change-${Date.now()}`,
          type: 'COACHING',
        },
      },
      adminToken,
    );
    expect(created.errors).toBeUndefined();
    const instituteId = created.data?.adminCreateInstitute.id;
    assert(instituteId);
    await waitForSetupComplete(instituteId, adminToken, 30_000);
    // Login is refused for an institute that is not ACTIVE.
    const activated = await gql<{ adminActivateInstitute: { status: string } }>(
      `mutation ($id: ID!) { adminActivateInstitute(id: $id) { status } }`,
      { id: instituteId },
      adminToken,
    );
    expect(activated.errors).toBeUndefined();
    expect(activated.data?.adminActivateInstitute.status).toBe('ACTIVE');

    const usersRes = await gql<{
      adminListUsers: { edges: Array<{ node: { id: string; email: string; username: string } }> };
    }>(
      `query ($tenantId: String!) {
        adminListUsers(filter: { tenantId: $tenantId, first: 10 }) { edges { node { id email username } } }
      }`,
      { tenantId: instituteId },
      adminToken,
    );
    expect(usersRes.errors).toBeUndefined();
    const account = usersRes.data?.adminListUsers.edges.find(
      (edge) => edge.node.email === firstAdmin.email,
    )?.node;
    assert(account);
    const welcome = await waitForEmail(firstAdmin.email, 'Welcome to Roviq');
    const tempPassword = tempPasswordFrom(welcome.text);

    const first = await gql<InstituteLogin>(INSTITUTE_LOGIN, {
      u: account.username,
      p: tempPassword,
    });
    expect(first.errors).toBeUndefined();
    const token = first.data?.instituteLogin.accessToken;
    assert(token);

    const blocked = await gql(`query { myInstitute { id } }`, undefined, token);
    expect(blocked.errors?.[0]?.extensions?.code).toBe('PASSWORD_CHANGE_REQUIRED');
    const me = await gql<{ me: { id: string } }>(`query { me { id } }`, undefined, token);
    expect(me.errors).toBeUndefined();
    expect(me.data?.me.id).toBe(account.id);

    const changed = await gql<{ changePassword: boolean }>(
      `mutation ($c: String!, $n: String!) { changePassword(currentPassword: $c, newPassword: $n) }`,
      { c: tempPassword, n: NEW_PASSWORD },
      token,
    );
    expect(changed.errors).toBeUndefined();
    expect(changed.data?.changePassword).toBe(true);

    const fresh = await gql<InstituteLogin>(INSTITUTE_LOGIN, {
      u: account.username,
      p: NEW_PASSWORD,
    });
    const freshToken = fresh.data?.instituteLogin.accessToken;
    assert(freshToken);
    const allowed = await gql<{ myInstitute: { id: string } }>(
      `query { myInstitute { id } }`,
      undefined,
      freshToken,
    );
    expect(allowed.errors).toBeUndefined();
    expect(allowed.data?.myInstitute.id).toBe(instituteId);
  });
});
