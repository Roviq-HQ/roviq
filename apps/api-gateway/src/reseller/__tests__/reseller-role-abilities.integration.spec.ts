/**
 * ROV-284: the support and viewer reseller roles carry explicit ability lists, proven through
 * the real guards with each role's stored abilities.
 */
import type { ResellerSystemRoleName } from '@roviq/common-types';
import {
  mkAdminCtx,
  provisionResellerSystemRoles,
  resellerMemberships,
  withAdmin,
} from '@roviq/database';
import {
  cleanupTestReseller,
  createIntegrationApp,
  createResellerToken,
  createTestReseller,
  gqlRequest,
  type IntegrationAppResult,
  type TestReseller,
} from '@roviq/testing/integration';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app/app.module';

const STATISTICS = `query { resellerInstituteStatistics { __typename } }`;
const INSTITUTES = `query { resellerListInstitutes { totalCount } }`;
const GATEWAY_CONFIGS = `query { gatewayConfigs { id } }`;
const AUDIT_LOGS = `query { resellerAuditLogs { totalCount } }`;
const USERS = `query { resellerListUsers { totalCount } }`;
const TEAM = `query { resellerListTeamMembers { totalCount } }`;

describe('Reseller support and viewer abilities (ROV-284)', () => {
  let result: IntegrationAppResult;
  let reseller: TestReseller;
  let roleIds: Record<ResellerSystemRoleName, string>;

  const admin = <T>(fn: Parameters<typeof withAdmin<T>>[2]) =>
    withAdmin(result.db, mkAdminCtx('test:reseller-role-abilities'), fn);

  const codeOf = (response: Awaited<ReturnType<typeof gqlRequest>>) =>
    response.errors?.[0]?.extensions?.code;

  async function tokenAs(role: ResellerSystemRoleName): Promise<string> {
    await admin((tx) =>
      tx
        .update(resellerMemberships)
        .set({ roleId: roleIds[role], abilities: [] })
        .where(eq(resellerMemberships.id, reseller.membershipId)),
    );
    return createResellerToken({
      sub: reseller.userId,
      resellerId: reseller.resellerId,
      membershipId: reseller.membershipId,
      roleId: roleIds[role],
    });
  }

  const ask = async (query: string, token: string) =>
    codeOf(await gqlRequest(result.httpServer, { query, token })) ?? 'OK';

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    reseller = await createTestReseller(result.db);
    roleIds = await admin((tx) =>
      provisionResellerSystemRoles(tx, reseller.resellerId, reseller.userId),
    );
  });

  afterAll(async () => {
    await cleanupTestReseller(result.db, reseller);
    await result?.close();
  });

  it('should let a viewer read institutes and statistics and refuse users, team, audit and gateways', async () => {
    const token = await tokenAs('reseller_viewer');

    expect({
      statistics: await ask(STATISTICS, token),
      institutes: await ask(INSTITUTES, token),
      gatewayConfigs: await ask(GATEWAY_CONFIGS, token),
      auditLogs: await ask(AUDIT_LOGS, token),
      users: await ask(USERS, token),
      team: await ask(TEAM, token),
    }).toEqual({
      statistics: 'OK',
      institutes: 'OK',
      gatewayConfigs: 'FORBIDDEN',
      auditLogs: 'FORBIDDEN',
      users: 'FORBIDDEN',
      team: 'FORBIDDEN',
    });
  });

  it('should let a support admin read users and the team and refuse audit and gateways', async () => {
    const token = await tokenAs('reseller_support_admin');

    expect({
      statistics: await ask(STATISTICS, token),
      users: await ask(USERS, token),
      team: await ask(TEAM, token),
      gatewayConfigs: await ask(GATEWAY_CONFIGS, token),
      auditLogs: await ask(AUDIT_LOGS, token),
    }).toEqual({
      statistics: 'OK',
      users: 'OK',
      team: 'OK',
      gatewayConfigs: 'FORBIDDEN',
      auditLogs: 'FORBIDDEN',
    });
  });
});
