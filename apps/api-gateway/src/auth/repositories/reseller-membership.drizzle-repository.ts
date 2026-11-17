import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  mkAdminCtx,
  resellerMembershipsLive,
  resellersLive,
  rolesLive,
  withAdmin,
} from '@roviq/database';
import { and, eq } from 'drizzle-orm';
import { ResellerMembershipRepository } from './reseller-membership.repository';
import type { ResellerMembershipWithResellerAndRole } from './types';

@Injectable()
export class ResellerMembershipDrizzleRepository extends ResellerMembershipRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async findByUserId(userId: string): Promise<ResellerMembershipWithResellerAndRole[]> {
    const rows = await withAdmin(this.db, mkAdminCtx('repository:reseller-membership'), (tx) =>
      tx
        .select({
          id: resellerMembershipsLive.id,
          userId: resellerMembershipsLive.userId,
          resellerId: resellerMembershipsLive.resellerId,
          roleId: resellerMembershipsLive.roleId,
          isActive: resellerMembershipsLive.isActive,
          abilities: resellerMembershipsLive.abilities,
          resellerIdFk: resellersLive.id,
          resellerName: resellersLive.name,
          resellerSlug: resellersLive.slug,
          resellerIsActive: resellersLive.isActive,
          resellerStatus: resellersLive.status,
          roleIdFk: rolesLive.id,
          roleAbilities: rolesLive.abilities,
        })
        .from(resellerMembershipsLive)
        .innerJoin(resellersLive, eq(resellerMembershipsLive.resellerId, resellersLive.id))
        .innerJoin(rolesLive, eq(resellerMembershipsLive.roleId, rolesLive.id))
        .where(
          and(
            eq(resellerMembershipsLive.userId, userId),
            eq(resellerMembershipsLive.isActive, true),
          ),
        ),
    );

    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      resellerId: row.resellerId,
      roleId: row.roleId,
      isActive: row.isActive,
      abilities: row.abilities,
      reseller: {
        id: row.resellerIdFk,
        name: row.resellerName,
        slug: row.resellerSlug,
        isActive: row.resellerIsActive,
        status: row.resellerStatus,
      },
      role: { id: row.roleIdFk, abilities: row.roleAbilities },
    }));
  }

  async findByUserAndReseller(
    userId: string,
    resellerId: string,
  ): Promise<ResellerMembershipWithResellerAndRole | null> {
    const rows = await this.findByUserId(userId);
    return rows.find((r) => r.resellerId === resellerId) ?? null;
  }
}
