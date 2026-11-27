/**
 * An institute's own row and its branding, configuration and role loads run as the caller's own
 * database role (ROV-383). Proved through GraphQL and by reading the stored rows.
 */
import { AbilityFactory, MembershipAbilityRepository, RoleRepository } from '@roviq/casl';
import {
  type DrizzleDB,
  instituteBranding,
  instituteConfigs,
  institutes,
  mkAdminCtx,
  withAdmin,
} from '@roviq/database';
import {
  cleanupTestReseller,
  createInstituteToken,
  createIntegrationApp,
  createPlatformToken,
  createResellerToken,
  createTestInstitute,
  createTestReseller,
  gqlRequest,
  type IntegrationAppResult,
  type TestInstitute,
  type TestReseller,
} from '@roviq/testing/integration';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../../../../../e2e/shared/seed-fixtures';
import { AppModule } from '../../../app/app.module';

const ORIGIN = 'test:institute-details-scope';

const DETAILS = 'branding { primaryColor } config { attendanceType openingTime }';
const MY_INSTITUTE = `query { myInstitute { id timezone version ${DETAILS} } }`;
const RESELLER_GET = `query($id: ID!) { resellerGetInstitute(id: $id) { id ${DETAILS} } }`;
const ADMIN_GET = `query($id: ID!) { adminGetInstitute(id: $id) { id ${DETAILS} } }`;
const UPDATE_INFO = `mutation($input: UpdateInstituteInfoInput!) {
  updateInstituteInfo(input: $input) { id timezone version }
}`;
const UPDATE_BRANDING = `mutation($input: UpdateInstituteBrandingInput!) {
  updateInstituteBranding(input: $input) { id branding { primaryColor } }
}`;
const UPDATE_CONFIG = `mutation($input: UpdateInstituteConfigInput!) {
  updateInstituteConfig(input: $input) { id config { openingTime } }
}`;
const UPDATE_LOCALES = `mutation($input: UpdateInstituteLocalesInput!) {
  updateInstituteLocales(input: $input) { id supportedLocales defaultLocale version }
}`;

interface Details {
  id: string;
  branding: { primaryColor: string | null } | null;
  config: { attendanceType: string; openingTime: string | null } | null;
}

describe('own institute row, details and role loads run as the caller (ROV-383)', () => {
  let result: IntegrationAppResult;
  let owner: TestReseller;
  let stranger: TestReseller;
  let instA: TestInstitute;
  let instB: TestInstitute;
  let tokenA: string;

  const asAdmin = <T>(fn: (tx: DrizzleDB) => Promise<T>) =>
    withAdmin(result.db, mkAdminCtx(ORIGIN), fn);

  const stored = (tenantId: string) =>
    asAdmin(async (tx) => {
      const [institute] = await tx
        .select({
          timezone: institutes.timezone,
          version: institutes.version,
          status: institutes.status,
          supportedLocales: institutes.supportedLocales,
          updatedAt: institutes.updatedAt,
        })
        .from(institutes)
        .where(eq(institutes.id, tenantId));
      const branding = await tx
        .select({ primaryColor: instituteBranding.primaryColor })
        .from(instituteBranding)
        .where(eq(instituteBranding.tenantId, tenantId));
      const config = await tx
        .select({ openingTime: instituteConfigs.openingTime })
        .from(instituteConfigs)
        .where(eq(instituteConfigs.tenantId, tenantId));
      return { institute, branding, config };
    });

  const tokenOf = (inst: TestInstitute, roleId = inst.roleId) =>
    createInstituteToken({
      sub: inst.userId,
      tenantId: inst.tenantId,
      membershipId: inst.membershipId,
      roleId,
    });
  const resellerToken = (reseller: TestReseller) =>
    createResellerToken({
      sub: reseller.userId,
      resellerId: reseller.resellerId,
      membershipId: reseller.membershipId,
      roleId: reseller.roleId,
    });

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
    owner = await createTestReseller(result.db);
    stranger = await createTestReseller(result.db);
    instA = await createTestInstitute(result.db, { resellerId: owner.resellerId });
    instB = await createTestInstitute(result.db, { resellerId: owner.resellerId });
    tokenA = tokenOf(instA);
  });

  afterAll(async () => {
    if (result) {
      if (stranger) await cleanupTestReseller(result.db, stranger);
      await result.close();
    }
  });

  it('should save the profile, branding, configuration and languages of its own institute', async () => {
    const beforeB = await stored(instB.tenantId);
    const first = await gqlRequest<{ myInstitute: Details & { version: number } }>(
      result.httpServer,
      { query: MY_INSTITUTE, token: tokenA },
    );
    expect(first.errors).toBeUndefined();
    const version = first.data?.myInstitute.version ?? 0;

    const info = await gqlRequest<{ updateInstituteInfo: { timezone: string; version: number } }>(
      result.httpServer,
      {
        query: UPDATE_INFO,
        variables: { input: { timezone: 'Asia/Dubai', version } },
        token: tokenA,
      },
    );
    expect(info.errors).toBeUndefined();
    expect(info.data?.updateInstituteInfo).toMatchObject({
      timezone: 'Asia/Dubai',
      version: version + 1,
    });

    const branding = await gqlRequest(result.httpServer, {
      query: UPDATE_BRANDING,
      variables: { input: { primaryColor: '#123456' } },
      token: tokenA,
    });
    expect(branding.errors).toBeUndefined();

    const config = await gqlRequest(result.httpServer, {
      query: UPDATE_CONFIG,
      variables: { input: { openingTime: '07:45' } },
      token: tokenA,
    });
    expect(config.errors).toBeUndefined();

    const locales = await gqlRequest<{ updateInstituteLocales: { supportedLocales: string[] } }>(
      result.httpServer,
      {
        query: UPDATE_LOCALES,
        variables: {
          input: { supportedLocales: ['en', 'hi'], defaultLocale: 'en', version: version + 1 },
        },
        token: tokenA,
      },
    );
    expect(locales.errors).toBeUndefined();

    const afterA = await stored(instA.tenantId);
    expect(afterA.institute).toMatchObject({
      timezone: 'Asia/Dubai',
      version: version + 2,
      supportedLocales: ['en', 'hi'],
    });
    expect(afterA.branding).toEqual([{ primaryColor: '#123456' }]);
    expect(afterA.config.map((row) => row.openingTime?.slice(0, 5))).toEqual(['07:45']);
    expect(await stored(instB.tenantId)).toEqual(beforeB);
  });

  it('should refuse a stale version and write nothing', async () => {
    const before = await stored(instA.tenantId);
    const res = await gqlRequest(result.httpServer, {
      query: UPDATE_INFO,
      variables: { input: { timezone: 'UTC', version: 0 } },
      token: tokenA,
    });
    expect(res.errors?.map((error) => error.extensions?.code)).toEqual(['CONCURRENT_MODIFICATION']);
    expect(await stored(instA.tenantId)).toEqual(before);
  });

  it('should read the details as the institute, its reseller and the platform', async () => {
    const own = await gqlRequest<{ myInstitute: Details }>(result.httpServer, {
      query: MY_INSTITUTE,
      token: tokenA,
    });
    expect(own.data?.myInstitute.branding).toEqual({ primaryColor: '#123456' });
    expect(own.data?.myInstitute.config?.openingTime?.slice(0, 5)).toBe('07:45');

    const asOwner = await gqlRequest<{ resellerGetInstitute: Details }>(result.httpServer, {
      query: RESELLER_GET,
      variables: { id: instA.tenantId },
      token: resellerToken(owner),
    });
    expect(asOwner.errors).toBeUndefined();
    expect(asOwner.data?.resellerGetInstitute.branding).toEqual({ primaryColor: '#123456' });

    const asPlatform = await gqlRequest<{ adminGetInstitute: Details }>(result.httpServer, {
      query: ADMIN_GET,
      variables: { id: instA.tenantId },
      token: createPlatformToken({
        sub: SEED_IDS.USER_ADMIN,
        membershipId: SEED_IDS.USER_ADMIN,
        roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
      }),
    });
    expect(asPlatform.errors).toBeUndefined();
    expect(asPlatform.data?.adminGetInstitute.branding).toEqual({ primaryColor: '#123456' });
  });

  it('should refuse another reseller the institute and its details', async () => {
    const res = await gqlRequest(result.httpServer, {
      query: RESELLER_GET,
      variables: { id: instA.tenantId },
      token: resellerToken(stranger),
    });
    expect(res.errors?.map((error) => error.extensions?.code)).toEqual(['INSTITUTE_NOT_FOUND']);
    expect(JSON.stringify(res)).not.toContain('#123456');
  });

  it('should not load a role of another institute for an institute caller', async () => {
    const roles = result.app.get(RoleRepository);
    const factory = result.app.get(AbilityFactory);

    const own = await roles.findInstituteAbilities(instA.roleId, instA.tenantId);
    expect(own?.abilities?.length).toBeGreaterThan(0);
    expect(await roles.findInstituteAbilities(instB.roleId, instA.tenantId)).toBeNull();

    // The other institute's own entry is cached first: it must not serve this caller.
    expect((await factory.getRoleAbilities(instB.roleId, instB.tenantId)).length).toBeGreaterThan(
      0,
    );
    expect(await factory.getRoleAbilities(instB.roleId, instA.tenantId)).toEqual([]);
  });

  it('should load a membership only for its own institute', async () => {
    const memberships = result.app.get(MembershipAbilityRepository);

    expect(await memberships.findAbilities(instA.membershipId, instA.tenantId)).not.toBeNull();
    expect(await memberships.findAbilities(instB.membershipId, instA.tenantId)).toBeNull();
  });
});
