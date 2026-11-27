/**
 * ROV-290 — institute scope exposes no platform-level institute or
 * institute-group operations, and its remaining ones act only on the
 * caller's own institute.
 */
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { GroupType } from '@roviq/common-types';
import { beforeAll, describe, expect, it } from 'vitest';
import { SEED } from '../../shared/seed-fixtures';
import {
  loginAsInstituteAdmin,
  loginAsInstituteAdminSecondInstitute,
  loginAsPlatformAdmin,
  loginAsStudent,
} from './helpers/auth';
import { gql } from './helpers/gql-client';

const VALIDATION_FAILED = 'GRAPHQL_VALIDATION_FAILED';
const SUFFIX = Date.now().toString(36);

const REMOVED_INSTITUTE_OPERATIONS = [
  ['institutes', 'query { institutes { totalCount } }'],
  ['institute', 'query ($id: ID!) { institute(id: $id) { id } }'],
  ['activateInstitute', 'mutation ($id: ID!) { activateInstitute(id: $id) { id } }'],
  ['deactivateInstitute', 'mutation ($id: ID!) { deactivateInstitute(id: $id) { id } }'],
  ['suspendInstitute', 'mutation ($id: ID!) { suspendInstitute(id: $id) { id } }'],
  ['rejectInstitute', 'mutation ($id: ID!) { rejectInstitute(id: $id) { id } }'],
  ['deleteInstitute', 'mutation ($id: ID!) { deleteInstitute(id: $id) }'],
  ['restoreInstitute', 'mutation ($id: ID!) { restoreInstitute(id: $id) { id } }'],
] as const;

const REMOVED_GROUP_OPERATIONS = [
  ['instituteGroups', 'query { instituteGroups { totalCount } }'],
  ['instituteGroup', 'query ($id: ID!) { instituteGroup(id: $id) { id } }'],
  [
    'updateInstituteGroup',
    'mutation ($id: ID!) { updateInstituteGroup(id: $id, input: {}) { id } }',
  ],
  ['activateInstituteGroup', 'mutation ($id: ID!) { activateInstituteGroup(id: $id) { id } }'],
  ['deactivateInstituteGroup', 'mutation ($id: ID!) { deactivateInstituteGroup(id: $id) { id } }'],
  ['suspendInstituteGroup', 'mutation ($id: ID!) { suspendInstituteGroup(id: $id) { id } }'],
  ['deleteInstituteGroup', 'mutation ($id: ID!) { deleteInstituteGroup(id: $id) }'],
  [
    'addInstituteToGroup',
    'mutation ($id: ID!) { addInstituteToGroup(instituteId: $id, groupId: $id) }',
  ],
  [
    'removeInstituteFromGroup',
    'mutation ($id: ID!) { removeInstituteFromGroup(instituteId: $id) }',
  ],
  [
    'addGroupMember',
    'mutation ($id: ID!) { addGroupMember(groupId: $id, userId: $id, roleId: $id) { id } }',
  ],
  ['removeGroupMember', 'mutation ($id: ID!) { removeGroupMember(groupId: $id, userId: $id) }'],
] as const;

function expectMissingField(res: Awaited<ReturnType<typeof gql>>, field: string): void {
  expect(res.data ?? null).toBeNull();
  assert(res.errors);
  expect(res.errors[0].extensions?.code).toBe(VALIDATION_FAILED);
  expect(res.errors.map((e) => e.message).join('\n')).toContain(`Cannot query field "${field}"`);
}

describe('Institute scope isolation (ROV-290)', () => {
  let adminToken: string;
  let instituteToken: string;
  let secondInstituteToken: string;
  let studentToken: string;
  // An id that matches nothing, so a still-exposed mutation fails without touching seed data.
  const unknownId = randomUUID();

  beforeAll(async () => {
    adminToken = (await loginAsPlatformAdmin()).accessToken;
    instituteToken = (await loginAsInstituteAdmin()).accessToken;
    secondInstituteToken = (await loginAsInstituteAdminSecondInstitute()).accessToken;
    studentToken = (await loginAsStudent()).accessToken;
  });

  describe('platform-level institute operations are absent', () => {
    it.each(REMOVED_INSTITUTE_OPERATIONS)('%s is not in the schema', async (name, query) => {
      const variables = query.includes('$id') ? { id: unknownId } : undefined;
      expectMissingField(await gql(query, variables, instituteToken), name);
    });

    it('createInstitute is not in the schema', async () => {
      const res = await gql(
        'mutation { createInstitute(input: { name: { en: "X" } }) { id } }',
        undefined,
        instituteToken,
      );
      expectMissingField(res, 'createInstitute');
    });

    it('a student cannot list institutes either', async () => {
      const res = await gql('query { institutes { totalCount } }', undefined, studentToken);
      expectMissingField(res, 'institutes');
    });
  });

  describe('updateInstituteInfo acts only on the caller’s institute', () => {
    it('rejects an id argument aimed at another institute', async () => {
      const before = await gql<{ myInstitute: { version: number } }>(
        'query { myInstitute { version } }',
        undefined,
        secondInstituteToken,
      );
      expect(before.errors).toBeUndefined();
      assert(before.data);

      const res = await gql(
        `mutation ($id: ID!, $input: UpdateInstituteInfoInput!) {
          updateInstituteInfo(id: $id, input: $input) { id }
        }`,
        {
          id: SEED.INSTITUTE_2.id,
          input: { version: before.data.myInstitute.version, timezone: 'Asia/Dubai' },
        },
        instituteToken,
      );
      expect(res.data ?? null).toBeNull();
      assert(res.errors);
      expect(res.errors[0].extensions?.code).toBe(VALIDATION_FAILED);
      expect(res.errors.map((e) => e.message).join('\n')).toContain('Unknown argument "id"');

      const after = await gql<{ myInstitute: { version: number } }>(
        'query { myInstitute { version } }',
        undefined,
        secondInstituteToken,
      );
      expect(after.data?.myInstitute.version).toBe(before.data.myInstitute.version);
    });

    it('updates the caller’s own institute without an id', async () => {
      const current = await gql<{
        myInstitute: { id: string; version: number; timezone: string };
      }>('query { myInstitute { id version timezone } }', undefined, instituteToken);
      assert(current.data);
      const { id, version, timezone } = current.data.myInstitute;

      const res = await gql<{ updateInstituteInfo: { id: string; version: number } }>(
        `mutation ($input: UpdateInstituteInfoInput!) {
          updateInstituteInfo(input: $input) { id version }
        }`,
        { input: { version, timezone } },
        instituteToken,
      );
      expect(res.errors).toBeUndefined();
      expect(res.data?.updateInstituteInfo.id).toBe(id);
      expect(res.data?.updateInstituteInfo.version).toBe(version + 1);
    });
  });

  describe('institute-group management is absent', () => {
    it.each(REMOVED_GROUP_OPERATIONS)('%s is not in the schema', async (name, query) => {
      const variables = query.includes('$id') ? { id: unknownId } : undefined;
      expectMissingField(await gql(query, variables, instituteToken), name);
    });

    it('createInstituteGroup is not in the schema', async () => {
      const res = await gql(
        `mutation ($input: CreateInstituteGroupInput!) { createInstituteGroup(input: $input) { id } }`,
        { input: { name: 'X', code: `x-${SUFFIX}`, type: GroupType.CHAIN } },
        instituteToken,
      );
      expectMissingField(res, 'createInstituteGroup');
    });

    it('myGroups still answers', async () => {
      const res = await gql<{ myGroups: { id: string }[] }>(
        'query { myGroups { id } }',
        undefined,
        instituteToken,
      );
      expect(res.errors).toBeUndefined();
      expect(Array.isArray(res.data?.myGroups)).toBe(true);
    });
  });

  describe('myInstituteGroup returns only the caller’s own group', () => {
    it('institute 1 sees its group, institute 2 does not', async () => {
      const created = await gql<{ adminCreateInstituteGroup: { id: string } }>(
        `mutation ($input: CreateInstituteGroupInput!) {
          adminCreateInstituteGroup(input: $input) { id }
        }`,
        { input: { name: 'Own Group Test', code: `own-${SUFFIX}`, type: GroupType.TRUST } },
        adminToken,
      );
      expect(created.errors).toBeUndefined();
      assert(created.data);
      const groupId = created.data.adminCreateInstituteGroup.id;

      try {
        const linked = await gql<{ adminAddInstituteToGroup: boolean }>(
          `mutation ($instituteId: ID!, $groupId: ID!) {
            adminAddInstituteToGroup(instituteId: $instituteId, groupId: $groupId)
          }`,
          { instituteId: SEED.INSTITUTE_1.id, groupId },
          adminToken,
        );
        expect(linked.errors).toBeUndefined();
        expect(linked.data?.adminAddInstituteToGroup).toBe(true);

        const own = await gql<{ myInstituteGroup: { id: string } | null }>(
          'query { myInstituteGroup { id } }',
          undefined,
          instituteToken,
        );
        expect(own.errors).toBeUndefined();
        expect(own.data?.myInstituteGroup?.id).toBe(groupId);

        const other = await gql<{ myInstituteGroup: { id: string } | null }>(
          'query { myInstituteGroup { id } }',
          undefined,
          secondInstituteToken,
        );
        expect(other.errors).toBeUndefined();
        expect(other.data?.myInstituteGroup?.id).not.toBe(groupId);
      } finally {
        await gql(
          'mutation ($instituteId: ID!) { adminRemoveInstituteFromGroup(instituteId: $instituteId) }',
          { instituteId: SEED.INSTITUTE_1.id },
          adminToken,
        );
        await gql(
          'mutation ($id: ID!) { adminDeleteInstituteGroup(id: $id) }',
          { id: groupId },
          adminToken,
        );
      }
    });
  });

  describe('institute admin abilities exclude platform subjects', () => {
    it('me.abilityRules denies institute-group management and institute lifecycle', async () => {
      const res = await gql<{
        me: { abilityRules: { action: string; subject: string; inverted?: boolean }[] };
      }>('query { me { abilityRules } }', undefined, instituteToken);
      expect(res.errors).toBeUndefined();
      assert(res.data);
      const denied = res.data.me.abilityRules
        .filter((rule) => rule.inverted === true)
        .map((rule) => `${rule.action} ${rule.subject}`);

      expect(denied).toContain('manage InstituteGroup');
      expect(denied).toContain('delete Institute');
      expect(denied).toContain('suspend Institute');
    });
  });
});
