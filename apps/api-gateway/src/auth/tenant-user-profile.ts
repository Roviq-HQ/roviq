import {
  type DrizzleDB,
  guardianProfilesLive,
  membershipsLive,
  phoneNumbersLive,
  tenantUserProfiles,
} from '@roviq/database';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';

type Gender = NonNullable<typeof tenantUserProfiles.$inferInsert.gender>;

export interface TenantUserProfileFields {
  firstName: Record<string, string>;
  lastName?: Record<string, string> | null;
  gender?: Gender | null;
  dateOfBirth?: string | null;
  bloodGroup?: string | null;
  religion?: string | null;
  motherTongue?: string | null;
}

/**
 * The institute's own record of a person, created with the membership. Run inside `withTenant`:
 * RLS refuses a row for any other institute. An existing row is left as it is, so a person who
 * gains a second role keeps what the institute already recorded.
 */
export async function ensureTenantUserProfile(
  tx: DrizzleDB,
  params: { tenantId: string; userId: string; actorId: string } & TenantUserProfileFields,
): Promise<void> {
  await tx
    .insert(tenantUserProfiles)
    .values({
      tenantId: params.tenantId,
      userId: params.userId,
      firstName: params.firstName,
      lastName: params.lastName ?? null,
      gender: params.gender ?? null,
      dateOfBirth: params.dateOfBirth ?? null,
      bloodGroup: params.bloodGroup ?? null,
      religion: params.religion ?? null,
      motherTongue: params.motherTongue ?? null,
      createdBy: params.actorId,
      updatedBy: params.actorId,
    })
    .onConflictDoNothing({
      target: [tenantUserProfiles.tenantId, tenantUserProfiles.userId],
      where: sql`deleted_at IS NULL`,
    });
}

/** Changes the institute's own record of a person. Run inside `withTenant`. */
export async function updateTenantUserProfile(
  tx: DrizzleDB,
  params: {
    tenantId: string;
    userId: string;
    actorId: string;
    changes: Partial<TenantUserProfileFields>;
  },
): Promise<void> {
  if (Object.keys(params.changes).length === 0) return;
  await tx
    .update(tenantUserProfiles)
    .set({
      ...params.changes,
      updatedBy: params.actorId,
      version: sql`${tenantUserProfiles.version} + 1`,
    })
    .where(
      and(
        eq(tenantUserProfiles.tenantId, params.tenantId),
        eq(tenantUserProfiles.userId, params.userId),
        isNull(tenantUserProfiles.deletedAt),
      ),
    );
}

/**
 * The guardian of this institute who already uses this number, if any (a sibling's parent).
 * A typed number proves nothing about who holds it (SF-040), so the match is narrow: only this
 * institute's active guardians, only a number that staff recorded (one the guardian typed
 * themselves would let them claim another family's next child), and only when exactly one
 * guardian has it. Run inside `withTenant`.
 */
export async function findActiveGuardianByPhone(
  tx: DrizzleDB,
  params: { tenantId: string; phone: { countryCode: string; number: string } },
): Promise<{ userId: string; guardianProfileId: string } | null> {
  const rows = await tx
    .select({ userId: guardianProfilesLive.userId, guardianProfileId: guardianProfilesLive.id })
    .from(guardianProfilesLive)
    .innerJoin(membershipsLive, eq(membershipsLive.id, guardianProfilesLive.membershipId))
    .innerJoin(phoneNumbersLive, eq(phoneNumbersLive.userId, guardianProfilesLive.userId))
    .where(
      and(
        eq(guardianProfilesLive.tenantId, params.tenantId),
        eq(membershipsLive.status, 'ACTIVE'),
        eq(phoneNumbersLive.countryCode, params.phone.countryCode),
        eq(phoneNumbersLive.number, params.phone.number),
        ne(phoneNumbersLive.updatedBy, phoneNumbersLive.userId),
      ),
    )
    .limit(2);
  return rows.length === 1 ? rows[0] : null;
}
