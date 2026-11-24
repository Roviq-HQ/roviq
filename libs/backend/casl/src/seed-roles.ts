import {
  type DrizzleDB,
  mkAdminCtx,
  refreshInstituteDefaultRoles,
  SYSTEM_USER_ID,
  withAdmin,
} from '@roviq/database';

/** The institute setup workflow's step: create or refresh the institute's default roles. */
export async function seedDefaultRoles(db: DrizzleDB, tenantId: string): Promise<void> {
  await withAdmin(db, mkAdminCtx('seeder:default-roles'), (tx) =>
    refreshInstituteDefaultRoles(tx, tenantId, SYSTEM_USER_ID),
  );
}
