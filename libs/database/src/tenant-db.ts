import type {
  AuthUser,
  InstituteContext,
  PlatformContext,
  ResellerContext,
  SignedInUser,
  SyntheticInstituteContext,
  SyntheticOrigin,
  SyntheticPlatformContext,
  SyntheticResellerContext,
} from '@roviq/common-types';
import { assertOwnSession } from '@roviq/common-types';
import { sql } from 'drizzle-orm';
import type { DrizzleDB } from './providers';

/**
 * Execute a callback within a tenant-scoped transaction.
 * Sets `ROLE roviq_app` + `app.current_tenant_id` so RLS policies apply.
 *
 * The branded `InstituteContext` parameter forces callers to narrow the auth
 * union before invoking — preventing platform/reseller contexts from sneaking
 * into a tenant transaction at compile time. Internal callers without a JWT
 * (workflow activities, seeders) must use `mkInstituteCtx(tenantId)`.
 */
export async function withTenant<T>(
  db: DrizzleDB,
  ctx: InstituteContext,
  callback: (tx: DrizzleDB) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE roviq_app`);
    await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${ctx.tenantId}, true)`);
    return callback(tx as DrizzleDB);
  });
}

/**
 * Execute a callback with admin role for policy-based RLS bypass.
 * Sets `ROLE roviq_admin` via SET LOCAL inside a transaction.
 *
 * SECURITY: RLS does not apply inside. Never run a query here with an id a
 * non-platform caller chose unless ownership was checked first (ROV-290);
 * `pnpm check:admin-context-reach` lists every such reachable function.
 */
export async function withAdmin<T>(
  db: DrizzleDB,
  _ctx: PlatformContext,
  callback: (tx: DrizzleDB) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE roviq_admin`);
    return callback(tx as DrizzleDB);
  });
}

/**
 * Execute a callback within a reseller-scoped transaction.
 * Sets `ROLE roviq_reseller` + `app.current_reseller_id` so RLS policies apply.
 */
export async function withReseller<T>(
  db: DrizzleDB,
  ctx: ResellerContext,
  callback: (tx: DrizzleDB) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE roviq_reseller`);
    await tx.execute(sql`SELECT set_config('app.current_reseller_id', ${ctx.resellerId}, true)`);
    return callback(tx as DrizzleDB);
  });
}

/**
 * What an impersonation session may do with one `withUser()` call. `'PERSON_ONLY'` refuses it.
 * `'IMPERSONATOR_MAY_READ'` lets it run in a read-only transaction: for the few reads the app
 * needs to show the impersonated person's screens. Each such call site is listed, with its
 * reason, in `own-account-access.ts` (`own-account-access.spec.ts`).
 */
export type OwnAccountAccess = 'PERSON_ONLY' | 'IMPERSONATOR_MAY_READ';

/**
 * Execute a callback as the signed-in person: `ROLE roviq_user` + `app.current_user_id`.
 * Row security then limits every statement to that person's own account rows, in any scope.
 *
 * The context must come from a verified token. There is no `mk*Ctx` for it, and one made by
 * the other factories is refused by the type and again here. An impersonation session is
 * refused with `IMPERSONATION_OWN_ACCOUNT` unless `access` lets it read, and then PostgreSQL
 * refuses any write in the transaction.
 */
export async function withUser<T>(
  db: DrizzleDB,
  ctx: SignedInUser,
  access: OwnAccountAccess,
  callback: (tx: DrizzleDB) => Promise<T>,
): Promise<T> {
  if ('syntheticOrigin' in ctx || !ctx.userId) {
    throw new Error('withUser needs the user of a verified token');
  }
  if (access !== 'IMPERSONATOR_MAY_READ') assertOwnSession(ctx);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE roviq_user`);
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${ctx.userId}, true)`);
    if (ctx.isImpersonated) await tx.execute(sql`SET LOCAL transaction_read_only = on`);
    return callback(tx as DrizzleDB);
  });
}

// Synthetic-context factories for callers without a JWT — workflow activities,
// seeders, internal repositories invoked from event consumers. They mint a
// minimal branded context so the wrapper signatures stay strict at the
// resolver/service entry-point. `origin` is required so every synthetic
// audit row is attributable to a workflow / consumer / seeder / test.
const SYNTHETIC_USER_ID = '00000000-0000-0000-0000-000000000000';

const SYNTHETIC_BASE = {
  userId: SYNTHETIC_USER_ID,
  membershipId: SYNTHETIC_USER_ID,
  roleId: SYNTHETIC_USER_ID,
  type: 'access' as const,
} satisfies Pick<AuthUser, 'userId' | 'membershipId' | 'roleId' | 'type'>;

export function mkAdminCtx(origin: SyntheticOrigin): SyntheticPlatformContext {
  return {
    ...SYNTHETIC_BASE,
    _scope: 'platform',
    scope: 'platform',
    syntheticOrigin: origin,
  };
}

export function mkResellerCtx(
  resellerId: string,
  origin: SyntheticOrigin,
): SyntheticResellerContext {
  return {
    ...SYNTHETIC_BASE,
    _scope: 'reseller',
    scope: 'reseller',
    resellerId,
    syntheticOrigin: origin,
  };
}

export function mkInstituteCtx(
  tenantId: string,
  origin: SyntheticOrigin,
): SyntheticInstituteContext {
  return {
    ...SYNTHETIC_BASE,
    _scope: 'institute',
    scope: 'institute',
    tenantId,
    syntheticOrigin: origin,
  };
}
