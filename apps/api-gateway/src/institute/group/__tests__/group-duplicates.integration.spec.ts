/**
 * ROV-358: a group saved under a name another live group of the institute has answers
 * GROUP_NAME_DUPLICATE, not INTERNAL_ERROR; the same name in another institute is allowed.
 */
import { ErrorCode } from '@roviq/common-types';
import {
  createInstituteToken,
  createIntegrationApp,
  createTestInstitute,
  type GqlResponse,
  gqlRequest,
  type IntegrationAppResult,
} from '@roviq/testing/integration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';

const CREATE = /* GraphQL */ `
  mutation ($input: CreateGroupInput!) {
    createGroup(input: $input) {
      id
    }
  }
`;
const UPDATE = /* GraphQL */ `
  mutation ($id: ID!, $input: UpdateGroupInput!) {
    updateGroup(id: $id, input: $input) {
      id
    }
  }
`;

type Gql = <T>(query: string, variables: Record<string, unknown>) => Promise<GqlResponse<T>>;

describe('group names (ROV-358)', () => {
  let app: IntegrationAppResult;
  let gqlA: Gql;
  let gqlB: Gql;

  const tokenFor = async () => {
    const inst = await createTestInstitute(app.db);
    const token = createInstituteToken({
      sub: inst.userId,
      tenantId: inst.tenantId,
      membershipId: inst.membershipId,
      roleId: inst.roleId,
    });
    const gql: Gql = (query, variables) => gqlRequest(app.httpServer, { query, variables, token });
    return gql;
  };

  const createGroup = (gql: Gql, name: string, extra: Record<string, unknown> = {}) =>
    gql<{ createGroup: { id: string } }>(CREATE, {
      input: { name, groupType: 'CLUB', ...extra },
    });

  beforeAll(async () => {
    app = await createIntegrationApp({ modules: [AppModule] });
    gqlA = await tokenFor();
    gqlB = await tokenFor();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('refuses a name another live group of the institute has, on create and on rename', async () => {
    const first = await createGroup(gqlA, 'Eco Club');
    expect(first.errors).toBeUndefined();
    expect((await createGroup(gqlA, 'Eco Club')).errors?.[0]?.extensions?.code).toBe(
      ErrorCode.GROUP_NAME_DUPLICATE,
    );

    const other = await createGroup(gqlA, 'Chess Club');
    const renamed = await gqlA(UPDATE, {
      id: other.data?.createGroup.id,
      input: { name: 'Eco Club' },
    });
    expect(renamed.errors?.[0]?.extensions?.code).toBe(ErrorCode.GROUP_NAME_DUPLICATE);
  });

  it('allows the same name in another institute', async () => {
    expect((await createGroup(gqlB, 'Eco Club')).errors).toBeUndefined();
  });

  it('refuses a child group listed twice', async () => {
    const child = await createGroup(gqlA, 'Junior Eco Club');
    const childId = child.data?.createGroup.id;
    const res = await createGroup(gqlA, 'Eco Clubs', {
      groupType: 'COMPOSITE',
      childGroupIds: [childId, childId],
    });
    expect(res.errors?.[0]?.extensions?.code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});
