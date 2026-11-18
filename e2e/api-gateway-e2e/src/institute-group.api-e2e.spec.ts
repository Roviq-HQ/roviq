/**
 * Institute Group domain E2E tests — migrated from
 *   e2e/api-gateway-e2e/hurl/institute-group/*.hurl
 *
 * Group management is platform scope: every scenario runs with the platform
 * admin token against the `admin*` operations (ROV-290).
 */
import assert from 'node:assert';
import { GroupStatus, GroupType } from '@roviq/common-types';
import { beforeAll, describe, expect, it } from 'vitest';
import { SEED } from '../../shared/seed-fixtures';
import { loginAsPlatformAdmin } from './helpers/auth';
import { gql } from './helpers/gql-client';

interface InstituteGroupNode {
  id: string;
  name: string;
  code: string;
  type: GroupType;
  status: GroupStatus;
  registrationNumber: string | null;
}

interface InstituteGroupEdge {
  node: Pick<InstituteGroupNode, 'id' | 'name' | 'code' | 'type' | 'status'>;
  cursor: string;
}

interface InstituteGroupConnection {
  edges: InstituteGroupEdge[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
  totalCount: number;
}

// Short unique suffix to avoid `code` collisions across retries / parallel
// workers — `code` has a unique index.
const SUFFIX = Date.now().toString(36);

describe('Institute Group E2E', () => {
  let adminToken: string;

  beforeAll(async () => {
    adminToken = (await loginAsPlatformAdmin()).accessToken;
  });

  // ─────────────────────────────────────────────────────
  // 01 — Admin CRUD lifecycle (@PlatformScope)
  // ─────────────────────────────────────────────────────
  describe('admin CRUD lifecycle', () => {
    it('create → update → list → delete', async () => {
      const code = `test-trust-${SUFFIX}`;

      // create
      const createRes = await gql<{ adminCreateInstituteGroup: InstituteGroupNode }>(
        `mutation AdminCreate($input: CreateInstituteGroupInput!) {
          adminCreateInstituteGroup(input: $input) {
            id name code type status registrationNumber
          }
        }`,
        { input: { name: 'Test Trust', code, type: GroupType.TRUST } },
        adminToken,
      );
      expect(createRes.errors).toBeUndefined();
      const created = createRes.data?.adminCreateInstituteGroup;
      assert(created);
      expect(created.id).toBeTruthy();
      expect(created.name).toBe('Test Trust');
      expect(created.code).toBe(code);
      expect(created.type).toBe(GroupType.TRUST);
      expect(created.status).toBe(GroupStatus.ACTIVE);

      const groupId = created.id;

      // update (version: 1 — first update bumps 1 → 2)
      const updateRes = await gql<{ adminUpdateInstituteGroup: InstituteGroupNode }>(
        `mutation AdminUpdate($id: ID!, $input: UpdateInstituteGroupInput!) {
          adminUpdateInstituteGroup(id: $id, input: $input) {
            id name code type status registrationNumber
          }
        }`,
        {
          id: groupId,
          input: {
            version: 1,
            name: 'Updated Trust',
            registrationNumber: 'REG-2026-001',
          },
        },
        adminToken,
      );
      expect(updateRes.errors).toBeUndefined();
      const updated = updateRes.data?.adminUpdateInstituteGroup;
      assert(updated);
      expect(updated.id).toBe(groupId);
      expect(updated.name).toBe('Updated Trust');
      expect(updated.registrationNumber).toBe('REG-2026-001');
      expect(updated.code).toBe(code);
      expect(updated.type).toBe(GroupType.TRUST);

      // list (no filter) — the row must appear
      const listRes = await gql<{ adminListInstituteGroups: InstituteGroupConnection }>(
        `query AdminList {
          adminListInstituteGroups {
            edges { node { id name code type status } cursor }
            pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
            totalCount
          }
        }`,
        {},
        adminToken,
      );
      expect(listRes.errors).toBeUndefined();
      const connection = listRes.data?.adminListInstituteGroups;
      assert(connection);
      expect(connection.totalCount).toBeGreaterThanOrEqual(1);
      expect(connection.edges.length).toBeGreaterThanOrEqual(1);
      const ids = connection.edges.map((e) => e.node.id);
      expect(ids).toContain(groupId);

      // list (search filter)
      const filteredRes = await gql<{ adminListInstituteGroups: InstituteGroupConnection }>(
        `query AdminList($filter: InstituteGroupFilterInput) {
          adminListInstituteGroups(filter: $filter) {
            edges { node { id name code } cursor }
            pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
            totalCount
          }
        }`,
        { filter: { search: code } },
        adminToken,
      );
      expect(filteredRes.errors).toBeUndefined();
      const filtered = filteredRes.data?.adminListInstituteGroups;
      assert(filtered);
      expect(filtered.totalCount).toBeGreaterThanOrEqual(1);

      // delete
      const deleteRes = await gql<{ adminDeleteInstituteGroup: boolean }>(
        `mutation AdminDelete($id: ID!) { adminDeleteInstituteGroup(id: $id) }`,
        { id: groupId },
        adminToken,
      );
      expect(deleteRes.errors).toBeUndefined();
      expect(deleteRes.data?.adminDeleteInstituteGroup).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────
  // 02 — Status transitions (@PlatformScope)
  // ─────────────────────────────────────────────────────
  describe('status transitions', () => {
    it('ACTIVE → INACTIVE → ACTIVE → SUSPENDED → ACTIVE → delete', async () => {
      const code = `chain-status-${SUFFIX}`;

      // create
      const createRes = await gql<{ adminCreateInstituteGroup: InstituteGroupNode }>(
        `mutation CreateInstituteGroup($input: CreateInstituteGroupInput!) {
          adminCreateInstituteGroup(input: $input) { id name code type status }
        }`,
        { input: { name: 'Chain Status Test', code, type: GroupType.CHAIN } },
        adminToken,
      );
      expect(createRes.errors).toBeUndefined();
      const created = createRes.data?.adminCreateInstituteGroup;
      assert(created);
      expect(created.status).toBe(GroupStatus.ACTIVE);
      const groupId = created.id;

      // deactivate
      const deactivateRes = await gql<{ adminDeactivateInstituteGroup: InstituteGroupNode }>(
        `mutation Deactivate($id: ID!) {
          adminDeactivateInstituteGroup(id: $id) { id status }
        }`,
        { id: groupId },
        adminToken,
      );
      expect(deactivateRes.errors).toBeUndefined();
      expect(deactivateRes.data?.adminDeactivateInstituteGroup.id).toBe(groupId);
      expect(deactivateRes.data?.adminDeactivateInstituteGroup.status).toBe(GroupStatus.INACTIVE);

      // activate (INACTIVE → ACTIVE)
      const activateRes = await gql<{ adminActivateInstituteGroup: InstituteGroupNode }>(
        `mutation Activate($id: ID!) {
          adminActivateInstituteGroup(id: $id) { id status }
        }`,
        { id: groupId },
        adminToken,
      );
      expect(activateRes.errors).toBeUndefined();
      expect(activateRes.data?.adminActivateInstituteGroup.status).toBe(GroupStatus.ACTIVE);

      // suspend
      const suspendRes = await gql<{ adminSuspendInstituteGroup: InstituteGroupNode }>(
        `mutation Suspend($id: ID!) {
          adminSuspendInstituteGroup(id: $id) { id status }
        }`,
        { id: groupId },
        adminToken,
      );
      expect(suspendRes.errors).toBeUndefined();
      expect(suspendRes.data?.adminSuspendInstituteGroup.status).toBe(GroupStatus.SUSPENDED);

      // activate (SUSPENDED → ACTIVE)
      const reactivateRes = await gql<{ adminActivateInstituteGroup: InstituteGroupNode }>(
        `mutation Activate($id: ID!) {
          adminActivateInstituteGroup(id: $id) { id status }
        }`,
        { id: groupId },
        adminToken,
      );
      expect(reactivateRes.errors).toBeUndefined();
      expect(reactivateRes.data?.adminActivateInstituteGroup.status).toBe(GroupStatus.ACTIVE);

      // delete (cleanup)
      const deleteRes = await gql<{ adminDeleteInstituteGroup: boolean }>(
        `mutation Delete($id: ID!) { adminDeleteInstituteGroup(id: $id) }`,
        { id: groupId },
        adminToken,
      );
      expect(deleteRes.errors).toBeUndefined();
      expect(deleteRes.data?.adminDeleteInstituteGroup).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────
  // 03 — Institute linking (@PlatformScope)
  // ─────────────────────────────────────────────────────
  describe('institute linking', () => {
    it('create group → add institute_1 → add institute_2 → remove institute_1 → cleanup', async () => {
      const code = `society-link-${SUFFIX}`;

      // create group
      const createRes = await gql<{ adminCreateInstituteGroup: InstituteGroupNode }>(
        `mutation CreateInstituteGroup($input: CreateInstituteGroupInput!) {
          adminCreateInstituteGroup(input: $input) { id name code type status }
        }`,
        { input: { name: 'Society Link Test', code, type: GroupType.SOCIETY } },
        adminToken,
      );
      expect(createRes.errors).toBeUndefined();
      const created = createRes.data?.adminCreateInstituteGroup;
      assert(created);
      expect(created.type).toBe(GroupType.SOCIETY);
      expect(created.status).toBe(GroupStatus.ACTIVE);
      const groupId = created.id;

      try {
        // add institute_1
        const add1Res = await gql<{ adminAddInstituteToGroup: boolean }>(
          `mutation AddToGroup($instituteId: ID!, $groupId: ID!) {
            adminAddInstituteToGroup(instituteId: $instituteId, groupId: $groupId)
          }`,
          { instituteId: SEED.INSTITUTE_1.id, groupId },
          adminToken,
        );
        expect(add1Res.errors).toBeUndefined();
        expect(add1Res.data?.adminAddInstituteToGroup).toBe(true);

        // add institute_2
        const add2Res = await gql<{ adminAddInstituteToGroup: boolean }>(
          `mutation AddToGroup($instituteId: ID!, $groupId: ID!) {
            adminAddInstituteToGroup(instituteId: $instituteId, groupId: $groupId)
          }`,
          { instituteId: SEED.INSTITUTE_2.id, groupId },
          adminToken,
        );
        expect(add2Res.errors).toBeUndefined();
        expect(add2Res.data?.adminAddInstituteToGroup).toBe(true);

        // remove institute_1
        const removeRes = await gql<{ adminRemoveInstituteFromGroup: boolean }>(
          `mutation RemoveFromGroup($instituteId: ID!) {
            adminRemoveInstituteFromGroup(instituteId: $instituteId)
          }`,
          { instituteId: SEED.INSTITUTE_1.id },
          adminToken,
        );
        expect(removeRes.errors).toBeUndefined();
        expect(removeRes.data?.adminRemoveInstituteFromGroup).toBe(true);
      } finally {
        // Always unlink institute_2 and delete the group so the seed is left
        // clean for other tests (institutes belong to the shared tenant seed).
        await gql(
          `mutation RemoveFromGroup($instituteId: ID!) {
            adminRemoveInstituteFromGroup(instituteId: $instituteId)
          }`,
          { instituteId: SEED.INSTITUTE_2.id },
          adminToken,
        );
        await gql(
          `mutation AdminDelete($id: ID!) { adminDeleteInstituteGroup(id: $id) }`,
          { id: groupId },
          adminToken,
        );
      }
    });
  });

  // ─────────────────────────────────────────────────────
  // 04 — Not-found errors (@PlatformScope)
  // ─────────────────────────────────────────────────────
  describe('not-found errors', () => {
    it('adminDeleteInstituteGroup with zero-UUID returns errors', async () => {
      const res = await gql<{ adminDeleteInstituteGroup: boolean | null }>(
        `mutation AdminDelete($id: ID!) { adminDeleteInstituteGroup(id: $id) }`,
        { id: '00000000-0000-0000-0000-000000000000' },
        adminToken,
      );
      expect(res.errors).toBeDefined();
      expect(res.errors?.length ?? 0).toBeGreaterThanOrEqual(1);
    });
  });
});
