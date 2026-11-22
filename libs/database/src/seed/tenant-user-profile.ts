import { sql } from 'drizzle-orm';
import { SYSTEM_USER_ID, tenantUserProfiles } from '..';
import type { DrizzleDB } from '../providers';

type TenantUserProfileSeed = Pick<
  typeof tenantUserProfiles.$inferInsert,
  | 'tenantId'
  | 'userId'
  | 'firstName'
  | 'lastName'
  | 'gender'
  | 'dateOfBirth'
  | 'bloodGroup'
  | 'religion'
  | 'motherTongue'
  | 'profileImageFileId'
>;

/** The institute's own copy of a seeded person's profile; a re-seed leaves an existing row. */
export async function seedTenantUserProfile(
  tx: DrizzleDB,
  profile: TenantUserProfileSeed,
): Promise<void> {
  await tx
    .insert(tenantUserProfiles)
    .values({ ...profile, createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID })
    .onConflictDoNothing({
      target: [tenantUserProfiles.tenantId, tenantUserProfiles.userId],
      where: sql`deleted_at IS NULL`,
    });
}
