import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DB, type DrizzleDB, mkAdminCtx, rolesLive, withAdmin } from '@roviq/database';
import { eq } from 'drizzle-orm';
import { RoleRepository } from './role.repository';
import type { AbilitiesRecord } from './types';

@Injectable()
export class RoleDrizzleRepository extends RoleRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async findAbilities(roleId: string): Promise<AbilitiesRecord | null> {
    return withAdmin(this.db, mkAdminCtx('repository:role-drizzle'), async (tx) => {
      const result = await tx
        .select({ abilities: rolesLive.abilities })
        .from(rolesLive)
        .where(eq(rolesLive.id, roleId))
        .limit(1);

      return result[0] ?? null;
    });
  }

  async findPrimaryNavSlugs(roleId: string): Promise<string[]> {
    return withAdmin(this.db, mkAdminCtx('repository:role-drizzle'), async (tx) => {
      const [row] = await tx
        .select({ primaryNavSlugs: rolesLive.primaryNavSlugs })
        .from(rolesLive)
        .where(eq(rolesLive.id, roleId))
        .limit(1);

      return row?.primaryNavSlugs ?? [];
    });
  }
}
