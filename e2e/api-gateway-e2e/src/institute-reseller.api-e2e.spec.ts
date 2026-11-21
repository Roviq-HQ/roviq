// Migration pattern (ROV-typed-e2e):
//   - GraphQL operations live in src/operations/*.graphql.
//   - `pnpm codegen` emits TypedDocumentNode constants in __generated__/graphql.ts.
//   - Specs import the *Document constants and pass them to gql() — variables and
//     the response `data` shape are inferred, no manual `gql<{...}>(...)` casts.
//   - Operation names are prefixed `E2e*` to avoid collisions with apps/web ops
//     (codegen merges all documents to detect duplicate operation names).
import assert from 'node:assert';
import { SetupStatus } from '@roviq/common-types';
import { beforeAll, describe, expect, it } from 'vitest';

import { SEED_IDS } from '../../shared/seed-fixtures';
import {
  E2eAdminActivateInstituteDocument,
  E2eAdminApproveInstituteDocument,
  E2eAdminDeleteInstituteDocument,
  E2eAdminDeleteInstituteGroupDocument,
  E2ePingDocument,
  E2eResellerCreateInstituteGroupDocument,
  E2eResellerCreateInstituteRequestDocument,
  E2eResellerGetInstituteDocument,
  E2eResellerInstituteStatisticsDocument,
  E2eResellerListInstituteGroupsDocument,
  E2eResellerListInstitutesDocument,
  E2eResellerReactivateInstituteDocument,
  E2eResellerSuspendInstituteDocument,
} from './__generated__/graphql';
import { loginAsPlatformAdmin, loginAsReseller } from './helpers/auth';
import { firstAdminInput } from './helpers/first-admin';
import { gql } from './helpers/gql-client';
import { waitForSetupComplete } from './helpers/wait-for-setup-complete';

/** The setup workflow runs about a dozen short activities; leave room for a cold worker. */
const SETUP_TIMEOUT_MS = 30_000;

describe('Institute Reseller (reseller scope) E2E', () => {
  let resellerToken: string;
  let adminToken: string;

  beforeAll(async () => {
    const ping = await gql(E2ePingDocument);
    expect(ping.data?.__typename).toBe('Query');

    const reseller = await loginAsReseller();
    resellerToken = reseller.accessToken;

    const admin = await loginAsPlatformAdmin();
    adminToken = admin.accessToken;
  });

  // ─────────────────────────────────────────────────────────────
  // 11: resellerCreateInstituteRequest + admin approval
  // ─────────────────────────────────────────────────────────────
  describe('resellerCreateInstituteRequest', () => {
    it('creates a PENDING_APPROVAL request, lists/gets it, then admin approves it', async () => {
      // 1. Reseller creates the request
      const slug = `e2e-reseller-req-${Date.now()}`;
      const firstAdmin = firstAdminInput();
      const createRes = await gql(
        E2eResellerCreateInstituteRequestDocument,
        {
          input: {
            name: { en: 'Reseller Request E2E' },
            slug,
            type: 'SCHOOL',
            departments: ['PRIMARY', 'SECONDARY'],
            board: 'CBSE',
            firstAdmin,
          },
        },
        resellerToken,
      );
      expect(createRes.errors).toBeUndefined();
      assert(createRes.data);
      const id = createRes.data.resellerCreateInstituteRequest.id;
      expect(id).toBeDefined();
      expect(createRes.data.resellerCreateInstituteRequest.slug).toBe(slug);
      expect(createRes.data.resellerCreateInstituteRequest.status).toBe('PENDING_APPROVAL');

      // 2. List
      const listRes = await gql(E2eResellerListInstitutesDocument, undefined, resellerToken);
      expect(listRes.errors).toBeUndefined();
      expect(listRes.data?.resellerListInstitutes.totalCount).toBeGreaterThanOrEqual(1);

      // 3. Get by id
      const getRes = await gql(E2eResellerGetInstituteDocument, { id }, resellerToken);
      expect(getRes.errors).toBeUndefined();
      assert(getRes.data);
      expect(getRes.data.resellerGetInstitute.id).toBe(id);
      expect(getRes.data.resellerGetInstitute.status).toBe('PENDING_APPROVAL');

      // 4. Statistics
      const statsRes = await gql(E2eResellerInstituteStatisticsDocument, undefined, resellerToken);
      expect(statsRes.errors).toBeUndefined();
      expect(statsRes.data?.resellerInstituteStatistics).not.toBeNull();

      // A request does not run setup; only the workflow that approval starts does.
      const beforeApproval = await gql<{ adminGetInstitute: { setupStatus: SetupStatus } }>(
        `query BeforeApproval($id: ID!) { adminGetInstitute(id: $id) { setupStatus } }`,
        { id },
        adminToken,
      );
      expect(beforeApproval.errors).toBeUndefined();
      expect(beforeApproval.data?.adminGetInstitute.setupStatus).toBe(SetupStatus.PENDING);

      // 5. Admin approves — PENDING_APPROVAL → PENDING
      const approveRes = await gql(E2eAdminApproveInstituteDocument, { id }, adminToken);
      expect(approveRes.errors).toBeUndefined();
      assert(approveRes.data);
      expect(approveRes.data.adminApproveInstitute.id).toBe(id);
      expect(approveRes.data.adminApproveInstitute.status).toBe('PENDING');

      // 6. Reseller sees the new status
      const verifyRes = await gql(E2eResellerGetInstituteDocument, { id }, resellerToken);
      expect(verifyRes.errors).toBeUndefined();
      expect(verifyRes.data?.resellerGetInstitute.status).toBe('PENDING');

      // 7. The InstituteSetupWorkflow worker (INSTITUTE_SETUP_WORKER_ENABLED) finishes setup
      //    and creates the first academic year.
      await waitForSetupComplete(id, adminToken, SETUP_TIMEOUT_MS);
      const treeRes = await gql<{
        adminGetInstituteAcademicTree: { instituteId: string; academicYearId: string | null };
      }>(
        `query ApprovedTree($id: ID!) {
          adminGetInstituteAcademicTree(instituteId: $id) { instituteId academicYearId }
        }`,
        { id },
        adminToken,
      );
      expect(treeRes.errors).toBeUndefined();
      expect(treeRes.data?.adminGetInstituteAcademicTree.instituteId).toBe(id);
      expect(treeRes.data?.adminGetInstituteAcademicTree.academicYearId).not.toBeNull();

      //    Setup also made the named first admin the institute admin.
      const usersRes = await gql<{
        adminListUsers: {
          edges: Array<{
            node: {
              email: string;
              profile: { firstName: Record<string, string> } | null;
              memberships: Array<{
                tenantId: string;
                status: string;
                roleName: Record<string, string> | null;
              }>;
            };
          }>;
        };
      }>(
        `query ApprovedInstituteUsers($tenantId: String!) {
          adminListUsers(filter: { tenantId: $tenantId, first: 50 }) {
            edges { node { email profile { firstName } memberships { tenantId status roleName } } }
          }
        }`,
        { tenantId: id },
        adminToken,
      );
      expect(usersRes.errors).toBeUndefined();
      const admins = (usersRes.data?.adminListUsers.edges ?? []).filter((edge) =>
        edge.node.memberships.some(
          (m) => m.tenantId === id && m.roleName?.en === 'institute_admin' && m.status === 'ACTIVE',
        ),
      );
      expect(admins.map((edge) => edge.node.email)).toEqual([firstAdmin.email]);
      expect(admins[0]?.node.profile?.firstName.en).toBe(firstAdmin.firstName);

      // 8. Cleanup via admin
      const delRes = await gql(E2eAdminDeleteInstituteDocument, { id }, adminToken);
      expect(delRes.errors).toBeUndefined();
      expect(delRes.data?.adminDeleteInstitute).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 12: resellerSuspendInstitute / resellerReactivateInstitute
  // ─────────────────────────────────────────────────────────────
  describe('resellerSuspend / resellerReactivate', () => {
    it('suspends and reactivates the seeded institute', async () => {
      const seedId = SEED_IDS.INSTITUTE_1;

      // Reentrancy: a failed prior run may have left the institute in a non-ACTIVE state.
      const checkRes = await gql(E2eResellerGetInstituteDocument, { id: seedId }, resellerToken);
      if (checkRes.data?.resellerGetInstitute?.status !== 'ACTIVE') {
        await gql(E2eAdminActivateInstituteDocument, { id: seedId }, adminToken);
      }

      // verify ACTIVE
      const initialRes = await gql(E2eResellerGetInstituteDocument, { id: seedId }, resellerToken);
      expect(initialRes.errors).toBeUndefined();
      expect(initialRes.data?.resellerGetInstitute.status).toBe('ACTIVE');

      // suspend
      const susRes = await gql(
        E2eResellerSuspendInstituteDocument,
        { id: seedId, reason: 'E2E test suspension' },
        resellerToken,
      );
      expect(susRes.errors).toBeUndefined();
      assert(susRes.data);
      expect(susRes.data.resellerSuspendInstitute.status).toBe('SUSPENDED');

      // verify
      const verSusRes = await gql(E2eResellerGetInstituteDocument, { id: seedId }, resellerToken);
      expect(verSusRes.errors).toBeUndefined();
      expect(verSusRes.data?.resellerGetInstitute.status).toBe('SUSPENDED');

      // reactivate
      const reactRes = await gql(
        E2eResellerReactivateInstituteDocument,
        { id: seedId },
        resellerToken,
      );
      expect(reactRes.errors).toBeUndefined();
      assert(reactRes.data);
      expect(reactRes.data.resellerReactivateInstitute.status).toBe('ACTIVE');

      // final verify
      const verReactRes = await gql(E2eResellerGetInstituteDocument, { id: seedId }, resellerToken);
      expect(verReactRes.errors).toBeUndefined();
      expect(verReactRes.data?.resellerGetInstitute.status).toBe('ACTIVE');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 13: resellerCreateInstituteGroup / resellerListInstituteGroups
  // ─────────────────────────────────────────────────────────────
  describe('reseller institute groups', () => {
    it('creates a group, lists groups, then admin cleans it up', async () => {
      const code = `reseller-e2e-group-${Date.now()}`;
      const createRes = await gql(
        E2eResellerCreateInstituteGroupDocument,
        {
          input: {
            name: 'Reseller E2E Group',
            code,
            type: 'SOCIETY',
          },
        },
        resellerToken,
      );
      expect(createRes.errors).toBeUndefined();
      assert(createRes.data);
      const created = createRes.data.resellerCreateInstituteGroup;
      const groupId = created.id;
      assert(typeof groupId === 'string');
      expect(created.name).toBe('Reseller E2E Group');
      expect(created.code).toBe(code);
      expect(created.type).toBe('SOCIETY');

      const listRes = await gql(E2eResellerListInstituteGroupsDocument, undefined, resellerToken);
      expect(listRes.errors).toBeUndefined();
      expect(listRes.data?.resellerListInstituteGroups.totalCount).toBeGreaterThan(0);

      // admin cleanup
      const delRes = await gql(E2eAdminDeleteInstituteGroupDocument, { id: groupId }, adminToken);
      expect(delRes.errors).toBeUndefined();
      expect(delRes.data?.adminDeleteInstituteGroup).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Cross-scope rejection
  // ─────────────────────────────────────────────────────────────
  describe('cross-scope rejection', () => {
    it('rejects unauthenticated resellerListInstitutes', async () => {
      const res = await gql(E2eResellerListInstitutesDocument);
      expect(res.errors).toBeDefined();
    });
  });
});
