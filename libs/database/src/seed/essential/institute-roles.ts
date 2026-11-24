import { SYSTEM_USER_ID } from '../../constants';
import { refreshDefaultRoleAbilities } from '../../institute-default-roles';
import type { DrizzleDB } from '../../providers';

/** Runs on every deploy, so a changed default ability list reaches every institute. */
export async function refreshAllInstituteDefaultRoles(tx: DrizzleDB): Promise<void> {
  await refreshDefaultRoleAbilities(tx, SYSTEM_USER_ID);
}
