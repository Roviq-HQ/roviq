import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  mkAdminCtx,
  platformMembershipsLive,
  rolesLive,
  withAdmin,
} from '@roviq/database';
import { and, eq } from 'drizzle-orm';
import { PlatformMembershipRepository } from './platform-membership.repository';
import type { PlatformMembershipWithRole } from './types';

@Injectable()
export class PlatformMembershipDrizzleRepository extends PlatformMembershipRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async findByUserId(userId: string): Promise<PlatformMembershipWithRole | null> {
    const [row] = await withAdmin(this.db, mkAdminCtx('repository:platform-membership'), (tx) =>
      tx
        .select({
          id: platformMembershipsLive.id,
          userId: platformMembershipsLive.userId,
          roleId: platformMembershipsLive.roleId,
          isActive: platformMembershipsLive.isActive,
          abilities: platformMembershipsLive.abilities,
          roleIdFk: rolesLive.id,
          roleAbilities: rolesLive.abilities,
        })
        .from(platformMembershipsLive)
        .innerJoin(rolesLive, eq(platformMembershipsLive.roleId, rolesLive.id))
        .where(
          and(
            eq(platformMembershipsLive.userId, userId),
            eq(platformMembershipsLive.isActive, true),
          ),
        )
        .limit(1),
    );

    if (!row) return null;

    return {
      id: row.id,
      userId: row.userId,
      roleId: row.roleId,
      isActive: row.isActive,
      abilities: row.abilities,
      role: { id: row.roleIdFk, abilities: row.roleAbilities },
    };
  }
}
