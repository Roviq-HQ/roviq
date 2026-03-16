import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  i18nDisplay,
  memberships,
  organizations,
  roles,
  withAdmin,
} from '@roviq/database';
import { and, eq, isNull } from 'drizzle-orm';
import { MembershipRepository } from './membership.repository';
import type { MembershipWithOrgAndRole, MembershipWithRole } from './types';

@Injectable()
export class MembershipDrizzleRepository extends MembershipRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async findActiveByUserId(userId: string): Promise<MembershipWithOrgAndRole[]> {
    const rows = await withAdmin(this.db, (tx) =>
      tx
        .select({
          id: memberships.id,
          tenantId: memberships.tenantId,
          roleId: memberships.roleId,
          status: memberships.status,
          abilities: memberships.abilities,
          orgId: organizations.id,
          orgName: organizations.name,
          orgSlug: organizations.slug,
          orgLogoUrl: organizations.logoUrl,
          roleIdFk: roles.id,
          roleName: roles.name,
          roleAbilities: roles.abilities,
        })
        .from(memberships)
        .innerJoin(organizations, eq(memberships.tenantId, organizations.id))
        .innerJoin(roles, eq(memberships.roleId, roles.id))
        .where(
          and(
            eq(memberships.userId, userId),
            eq(memberships.status, 'ACTIVE'),
            isNull(memberships.deletedAt),
          ),
        ),
    );

    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      roleId: row.roleId,
      status: row.status,
      abilities: row.abilities,
      organization: {
        id: row.orgId,
        name: i18nDisplay(row.orgName),
        slug: row.orgSlug,
        logoUrl: row.orgLogoUrl,
      },
      role: {
        id: row.roleIdFk,
        name: i18nDisplay(row.roleName),
        abilities: row.roleAbilities,
      },
    }));
  }

  async findByUserAndTenant(
    userId: string,
    tenantId: string,
  ): Promise<MembershipWithOrgAndRole | null> {
    const [row] = await withAdmin(this.db, (tx) =>
      tx
        .select({
          id: memberships.id,
          tenantId: memberships.tenantId,
          roleId: memberships.roleId,
          status: memberships.status,
          abilities: memberships.abilities,
          orgId: organizations.id,
          orgName: organizations.name,
          orgSlug: organizations.slug,
          orgLogoUrl: organizations.logoUrl,
          roleIdFk: roles.id,
          roleName: roles.name,
          roleAbilities: roles.abilities,
        })
        .from(memberships)
        .innerJoin(organizations, eq(memberships.tenantId, organizations.id))
        .innerJoin(roles, eq(memberships.roleId, roles.id))
        .where(
          and(
            eq(memberships.userId, userId),
            eq(memberships.tenantId, tenantId),
            eq(memberships.status, 'ACTIVE'),
            isNull(memberships.deletedAt),
          ),
        )
        .limit(1),
    );

    if (!row) return null;

    return {
      id: row.id,
      tenantId: row.tenantId,
      roleId: row.roleId,
      status: row.status,
      abilities: row.abilities,
      organization: {
        id: row.orgId,
        name: i18nDisplay(row.orgName),
        slug: row.orgSlug,
        logoUrl: row.orgLogoUrl,
      },
      role: {
        id: row.roleIdFk,
        name: i18nDisplay(row.roleName),
        abilities: row.roleAbilities,
      },
    };
  }

  async findFirstActive(userId: string): Promise<MembershipWithRole | null> {
    const [row] = await withAdmin(this.db, (tx) =>
      tx
        .select({
          id: memberships.id,
          tenantId: memberships.tenantId,
          roleId: memberships.roleId,
          status: memberships.status,
          abilities: memberships.abilities,
          roleIdFk: roles.id,
          roleAbilities: roles.abilities,
        })
        .from(memberships)
        .innerJoin(roles, eq(memberships.roleId, roles.id))
        .where(
          and(
            eq(memberships.userId, userId),
            eq(memberships.status, 'ACTIVE'),
            isNull(memberships.deletedAt),
          ),
        )
        .limit(1),
    );

    if (!row) return null;

    return {
      id: row.id,
      tenantId: row.tenantId,
      roleId: row.roleId,
      status: row.status,
      abilities: row.abilities,
      role: {
        id: row.roleIdFk,
        abilities: row.roleAbilities,
      },
    };
  }
}
