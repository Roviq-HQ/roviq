import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  filesLive,
  instituteBrandingLive,
  institutesLive,
  membershipsLive,
  mkAdminCtx,
  rolesLive,
  withAdmin,
} from '@roviq/database';
import { StorageClient } from '@roviq/storage';
import { and, asc, eq } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { variantKeyOf } from '../../files/storage-keys';
import { MembershipRepository } from './membership.repository';
import type { MembershipWithInstituteAndRole } from './types';

function readyLogoOf(logoFileId: PgColumn) {
  return and(eq(filesLive.id, logoFileId), eq(filesLive.status, 'READY'));
}

@Injectable()
export class MembershipDrizzleRepository extends MembershipRepository {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDB,
    private readonly storage: StorageClient,
  ) {
    super();
  }

  /** Branding logos are public images, so their link never expires. */
  private logoUrl(objectKey: string | null): string | null {
    return objectKey ? this.storage.publicUrl(variantKeyOf(objectKey, 'MD')) : null;
  }

  async findActiveByUserId(userId: string): Promise<MembershipWithInstituteAndRole[]> {
    const rows = await withAdmin(this.db, mkAdminCtx('repository:membership'), (tx) =>
      tx
        .select({
          id: membershipsLive.id,
          tenantId: membershipsLive.tenantId,
          roleId: membershipsLive.roleId,
          status: membershipsLive.status,
          abilities: membershipsLive.abilities,
          instituteId: institutesLive.id,
          instituteName: institutesLive.name,
          instituteSlug: institutesLive.slug,
          instituteLogoKey: filesLive.objectKey,
          instituteResellerId: institutesLive.resellerId,
          roleIdFk: rolesLive.id,
          roleName: rolesLive.name,
          roleAbilities: rolesLive.abilities,
        })
        .from(membershipsLive)
        .innerJoin(institutesLive, eq(membershipsLive.tenantId, institutesLive.id))
        .innerJoin(rolesLive, eq(membershipsLive.roleId, rolesLive.id))
        .leftJoin(instituteBrandingLive, eq(instituteBrandingLive.tenantId, institutesLive.id))
        .leftJoin(filesLive, readyLogoOf(instituteBrandingLive.logoFileId))
        .where(and(eq(membershipsLive.userId, userId), eq(membershipsLive.status, 'ACTIVE')))
        // Deterministic order — multi-institute admins see memberships in
        // creation order across requests; selection-step UI / e2e tests
        // can rely on a stable index.
        .orderBy(asc(membershipsLive.createdAt), asc(membershipsLive.id)),
    );

    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      roleId: row.roleId,
      status: row.status,
      abilities: row.abilities,
      institute: {
        id: row.instituteId,
        name: row.instituteName,
        slug: row.instituteSlug,
        logoUrl: this.logoUrl(row.instituteLogoKey),
        resellerId: row.instituteResellerId,
      },
      role: {
        id: row.roleIdFk,
        name: row.roleName,
        abilities: row.roleAbilities,
      },
    }));
  }

  async findManyByUserAndTenant(
    userId: string,
    tenantId: string,
  ): Promise<MembershipWithInstituteAndRole[]> {
    const rows = await withAdmin(this.db, mkAdminCtx('repository:membership'), (tx) =>
      tx
        .select({
          id: membershipsLive.id,
          tenantId: membershipsLive.tenantId,
          roleId: membershipsLive.roleId,
          status: membershipsLive.status,
          abilities: membershipsLive.abilities,
          instituteId: institutesLive.id,
          instituteName: institutesLive.name,
          instituteSlug: institutesLive.slug,
          instituteLogoKey: filesLive.objectKey,
          instituteResellerId: institutesLive.resellerId,
          roleIdFk: rolesLive.id,
          roleName: rolesLive.name,
          roleAbilities: rolesLive.abilities,
        })
        .from(membershipsLive)
        .innerJoin(institutesLive, eq(membershipsLive.tenantId, institutesLive.id))
        .innerJoin(rolesLive, eq(membershipsLive.roleId, rolesLive.id))
        .leftJoin(instituteBrandingLive, eq(instituteBrandingLive.tenantId, institutesLive.id))
        .leftJoin(filesLive, readyLogoOf(instituteBrandingLive.logoFileId))
        .where(
          and(
            eq(membershipsLive.userId, userId),
            eq(membershipsLive.tenantId, tenantId),
            eq(membershipsLive.status, 'ACTIVE'),
          ),
        ),
    );

    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      roleId: row.roleId,
      status: row.status,
      abilities: row.abilities,
      institute: {
        id: row.instituteId,
        name: row.instituteName,
        slug: row.instituteSlug,
        logoUrl: this.logoUrl(row.instituteLogoKey),
        resellerId: row.instituteResellerId,
      },
      role: {
        id: row.roleIdFk,
        name: row.roleName,
        abilities: row.roleAbilities,
      },
    }));
  }

  async findByIdAndUser(
    membershipId: string,
    userId: string,
  ): Promise<MembershipWithInstituteAndRole | null> {
    const [row] = await withAdmin(this.db, mkAdminCtx('repository:membership'), (tx) =>
      tx
        .select({
          id: membershipsLive.id,
          tenantId: membershipsLive.tenantId,
          roleId: membershipsLive.roleId,
          status: membershipsLive.status,
          abilities: membershipsLive.abilities,
          instituteId: institutesLive.id,
          instituteName: institutesLive.name,
          instituteSlug: institutesLive.slug,
          instituteLogoKey: filesLive.objectKey,
          instituteResellerId: institutesLive.resellerId,
          roleIdFk: rolesLive.id,
          roleName: rolesLive.name,
          roleAbilities: rolesLive.abilities,
        })
        .from(membershipsLive)
        .innerJoin(institutesLive, eq(membershipsLive.tenantId, institutesLive.id))
        .innerJoin(rolesLive, eq(membershipsLive.roleId, rolesLive.id))
        .leftJoin(instituteBrandingLive, eq(instituteBrandingLive.tenantId, institutesLive.id))
        .leftJoin(filesLive, readyLogoOf(instituteBrandingLive.logoFileId))
        .where(
          and(
            eq(membershipsLive.id, membershipId),
            eq(membershipsLive.userId, userId),
            eq(membershipsLive.status, 'ACTIVE'),
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
      institute: {
        id: row.instituteId,
        name: row.instituteName,
        slug: row.instituteSlug,
        logoUrl: this.logoUrl(row.instituteLogoKey),
        resellerId: row.instituteResellerId,
      },
      role: {
        id: row.roleIdFk,
        name: row.roleName,
        abilities: row.roleAbilities,
      },
    };
  }
}
