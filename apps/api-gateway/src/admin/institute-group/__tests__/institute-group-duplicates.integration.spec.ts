/**
 * ROV-358: an institute group code another live group has, and a member added twice, answer
 * their own codes, not INTERNAL_ERROR.
 */
import { randomUUID } from 'node:crypto';
import { ErrorCode } from '@roviq/common-types';
import {
  createIntegrationApp,
  createPlatformToken,
  createTestInstitute,
  type GqlResponse,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
} from '@roviq/testing/integration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../../../../../e2e/shared/seed-fixtures';
import { AppModule } from '../../../app/app.module';

const CREATE = /* GraphQL */ `
  mutation ($input: CreateInstituteGroupInput!) {
    adminCreateInstituteGroup(input: $input) {
      id
    }
  }
`;
const ADD_MEMBER = /* GraphQL */ `
  mutation ($groupId: ID!, $userId: ID!, $roleId: ID!) {
    adminAddInstituteGroupMember(groupId: $groupId, userId: $userId, roleId: $roleId) {
      id
    }
  }
`;

describe('institute group code and members (ROV-358)', () => {
  let app: IntegrationAppResult;
  let token: string;
  let inst: TestInstitute;

  const gql = <T>(query: string, variables: Record<string, unknown>): Promise<GqlResponse<T>> =>
    gqlRequest<T>(app.httpServer, { query, variables, token });

  const createGroup = (code: string) =>
    gql<{ adminCreateInstituteGroup: { id: string } }>(CREATE, {
      input: { name: `Trust ${code}`, code, type: 'TRUST' },
    });

  beforeAll(async () => {
    app = await createIntegrationApp({ modules: [AppModule] });
    token = createPlatformToken({
      sub: SEED_IDS.USER_ADMIN,
      membershipId: randomUUID(),
      roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
    });
    inst = await createTestInstitute(app.db);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('refuses a code another live institute group has', async () => {
    const code = `trust-${randomUUID().slice(0, 8)}`;
    expect((await createGroup(code)).errors).toBeUndefined();
    expect((await createGroup(code)).errors?.[0]?.extensions?.code).toBe(
      ErrorCode.INSTITUTE_GROUP_CODE_DUPLICATE,
    );
  });

  it('refuses adding a user who is already a member of the group', async () => {
    const created = await createGroup(`trust-${randomUUID().slice(0, 8)}`);
    const groupId = created.data?.adminCreateInstituteGroup.id;
    const member = { groupId, userId: inst.userId, roleId: inst.roleId };
    expect((await gql(ADD_MEMBER, member)).errors).toBeUndefined();
    expect((await gql(ADD_MEMBER, member)).errors?.[0]?.extensions?.code).toBe(
      ErrorCode.INSTITUTE_GROUP_MEMBER_DUPLICATE,
    );
  });
});
