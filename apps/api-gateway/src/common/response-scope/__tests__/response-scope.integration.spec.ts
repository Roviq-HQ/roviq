import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import {
  Args,
  Field,
  Int,
  Mutation,
  ObjectType,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { InstituteScope, PlatformScope, ResellerScope } from '@roviq/auth-backend';
import {
  cleanupTestInstitute,
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../../../../../e2e/shared/seed-fixtures';
import { AppModule } from '../../../app/app.module';
import { MAX_SCAN_NODES } from '../foreign-scope-finder';
import { ResponseScopeGauge } from '../response-scope-gauge';

/** The GraphQL type exposes no institute id: the check reads what the resolver returned. */
@ObjectType()
class ProbeRow {
  @Field()
  label!: string;
}

@ObjectType()
class ProbeParent {
  @Field()
  label!: string;

  @Field(() => [ProbeRow])
  children!: ProbeRow[];
}

/** A field resolver that loads rows of its own, as one with a loader or a repository does. */
@Resolver(() => ProbeParent)
class ProbeParentFieldResolver {
  @ResolveField(() => [ProbeRow])
  children(@Parent() parent: { childOwner: string }) {
    return Promise.resolve([{ label: 'child', tenantId: parent.childOwner }]);
  }
}

@InstituteScope()
@Resolver()
class InstituteProbeResolver {
  @Query(() => [ProbeRow])
  probeInstituteRows(@Args('owner') owner: string) {
    return [{ label: 'row', tenantId: owner }];
  }

  @Query(() => [ProbeParent])
  probeInstituteParents(@Args('owner') owner: string, @Args('childOwner') childOwner: string) {
    return [{ label: 'parent', tenantId: owner, childOwner }];
  }

  /** One row that drags `size` objects behind it, none of them in the GraphQL type. */
  @Query(() => ProbeRow)
  probeInstituteLarge(@Args('size', { type: () => Int }) size: number) {
    return { label: 'row', rest: Array.from({ length: size }, () => ({})) };
  }

  @Mutation(() => ProbeRow)
  probeInstituteWrite(@Args('owner') owner: string) {
    return { label: 'row', nested: { deep: [{ tenant_id: owner }] } };
  }
}

@ResellerScope()
@Resolver()
class ResellerProbeResolver {
  @Query(() => [ProbeRow])
  probeResellerRows(@Args('owner') owner: string, @Args('tenant') tenant: string) {
    return [{ label: 'row', resellerId: owner, tenantId: tenant }];
  }
}

@PlatformScope()
@Resolver()
class PlatformProbeResolver {
  @Query(() => [ProbeRow])
  probePlatformRows(@Args('owner') owner: string) {
    return [{ label: 'row', tenantId: owner, resellerId: owner }];
  }
}

@Module({
  providers: [
    ProbeParentFieldResolver,
    InstituteProbeResolver,
    ResellerProbeResolver,
    PlatformProbeResolver,
  ],
})
class ProbeModule {}

const INSTITUTE_ROWS = 'query($owner: String!) { probeInstituteRows(owner: $owner) { label } }';
const INSTITUTE_WRITE =
  'mutation($owner: String!) { probeInstituteWrite(owner: $owner) { label } }';
const INSTITUTE_PARENTS =
  'query($owner: String!, $childOwner: String!) { probeInstituteParents(owner: $owner, childOwner: $childOwner) { label children { label } } }';
const INSTITUTE_LARGE = 'query($size: Int!) { probeInstituteLarge(size: $size) { label } }';
const RESELLER_ROWS =
  'query($owner: String!, $tenant: String!) { probeResellerRows(owner: $owner, tenant: $tenant) { label } }';
const PLATFORM_ROWS = 'query($owner: String!) { probePlatformRows(owner: $owner) { label } }';

describe('response scope check through GraphQL', () => {
  let result: IntegrationAppResult;
  let own: TestInstitute;
  let other: TestInstitute;
  let reseller: TestReseller;
  let otherReseller: TestReseller;
  let instituteToken: string;
  let resellerToken: string;

  const count = (
    scope: 'institute' | 'reseller',
    reason: 'foreign_id' | 'too_large' = 'foreign_id',
  ) =>
    result.app
      .get(ResponseScopeGauge)
      .readings()
      .find((reading) => reading.scope === scope && reading.reason === reason)?.count;

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule, ProbeModule] });
    own = await createTestInstitute(result.db);
    other = await createTestInstitute(result.db);
    reseller = await createTestReseller(result.db);
    otherReseller = await createTestReseller(result.db);
    instituteToken = createInstituteToken({
      sub: own.userId,
      tenantId: own.tenantId,
      membershipId: own.membershipId,
      roleId: own.roleId,
    });
    resellerToken = createResellerToken({
      sub: reseller.userId,
      resellerId: reseller.resellerId,
      membershipId: reseller.membershipId,
      roleId: reseller.roleId,
    });
  });

  afterAll(async () => {
    if (result) {
      if (own) await cleanupTestInstitute(result.db, own);
      if (other) await cleanupTestInstitute(result.db, other);
      if (reseller) await cleanupTestReseller(result.db, reseller);
      if (otherReseller) await cleanupTestReseller(result.db, otherReseller);
      await result.close();
    }
  });

  it("should send a result that carries the caller's own institute", async () => {
    const res = await gqlRequest<{ probeInstituteRows: Array<{ label: string }> }>(
      result.httpServer,
      { query: INSTITUTE_ROWS, variables: { owner: own.tenantId }, token: instituteToken },
    );
    expect(res.errors).toBeUndefined();
    expect(res.data?.probeInstituteRows).toEqual([{ label: 'row' }]);
  });

  it("should refuse a query result that carries another institute's row and count it", async () => {
    const before = count('institute') ?? 0;
    const res = await gqlRequest(result.httpServer, {
      query: INSTITUTE_ROWS,
      variables: { owner: other.tenantId },
      token: instituteToken,
    });
    expect(res.errors?.map((error) => error.extensions?.code)).toEqual(['INTERNAL_ERROR']);
    expect(res.data).toBeNull();
    expect(JSON.stringify(res)).not.toContain(other.tenantId);
    expect(count('institute')).toBe(before + 1);
  });

  it("should refuse a mutation result with another institute's id nested in it", async () => {
    const res = await gqlRequest(result.httpServer, {
      query: INSTITUTE_WRITE,
      variables: { owner: other.tenantId },
      token: instituteToken,
    });
    expect(res.errors?.map((error) => error.extensions?.code)).toEqual(['INTERNAL_ERROR']);
    expect(JSON.stringify(res)).not.toContain(other.tenantId);
  });

  it("should send rows a field resolver loaded for the caller's own institute", async () => {
    const res = await gqlRequest<{ probeInstituteParents: unknown }>(result.httpServer, {
      query: INSTITUTE_PARENTS,
      variables: { owner: own.tenantId, childOwner: own.tenantId },
      token: instituteToken,
    });
    expect(res.errors).toBeUndefined();
    expect(res.data?.probeInstituteParents).toEqual([
      { label: 'parent', children: [{ label: 'child' }] },
    ]);
  });

  it("should refuse the whole response when a field resolver loads another institute's row", async () => {
    const before = count('institute') ?? 0;
    const res = await gqlRequest(result.httpServer, {
      query: INSTITUTE_PARENTS,
      variables: { owner: own.tenantId, childOwner: other.tenantId },
      token: instituteToken,
    });
    expect(res.errors?.map((error) => error.extensions?.code)).toEqual(['INTERNAL_ERROR']);
    expect(res.data).toBeNull();
    expect(JSON.stringify(res)).not.toContain(other.tenantId);
    expect(count('institute')).toBe(before + 1);
  });

  it('should send a large result that is still within the limit', async () => {
    const res = await gqlRequest(result.httpServer, {
      query: INSTITUTE_LARGE,
      variables: { size: 100_000 },
      token: instituteToken,
    });
    expect(res.errors).toBeUndefined();
  });

  it('should refuse and count a result too large to read in full', async () => {
    const before = count('institute', 'too_large') ?? 0;
    const res = await gqlRequest(result.httpServer, {
      query: INSTITUTE_LARGE,
      variables: { size: MAX_SCAN_NODES },
      token: instituteToken,
    });
    expect(res.errors?.map((error) => error.extensions?.code)).toEqual(['INTERNAL_ERROR']);
    expect(res.data).toBeNull();
    expect(count('institute', 'too_large')).toBe(before + 1);
  });

  it('should send a reseller its own rows, whichever of its institutes they name', async () => {
    const res = await gqlRequest(result.httpServer, {
      query: RESELLER_ROWS,
      variables: { owner: reseller.resellerId, tenant: other.tenantId },
      token: resellerToken,
    });
    expect(res.errors).toBeUndefined();
  });

  it("should refuse a reseller a result that carries another reseller's row", async () => {
    const before = count('reseller') ?? 0;
    const res = await gqlRequest(result.httpServer, {
      query: RESELLER_ROWS,
      variables: { owner: otherReseller.resellerId, tenant: other.tenantId },
      token: resellerToken,
    });
    expect(res.errors?.map((error) => error.extensions?.code)).toEqual(['INTERNAL_ERROR']);
    expect(JSON.stringify(res)).not.toContain(otherReseller.resellerId);
    expect(count('reseller')).toBe(before + 1);
  });

  it('should not check a platform caller, who reads every institute', async () => {
    const res = await gqlRequest(result.httpServer, {
      query: PLATFORM_ROWS,
      variables: { owner: other.tenantId },
      token: createPlatformToken({
        sub: SEED_IDS.USER_ADMIN,
        membershipId: randomUUID(),
        roleId: SEED_IDS.ROLE_PLATFORM_ADMIN,
      }),
    });
    expect(res.errors).toBeUndefined();
  });
});
