import {
  DEFAULT_PRIMARY_NAV_SLUGS,
  DEFAULT_ROLE_ABILITIES,
  DefaultRoles,
} from '@roviq/common-types';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { DrizzleDB } from './providers';
import { roles } from './schema/tenant/roles';

/**
 * Creates the institute's default roles or refreshes their abilities and navigation from the
 * code. The code is the source of truth for default roles; an institute that wants different
 * rules uses a custom role.
 */
export async function refreshInstituteDefaultRoles(
  tx: DrizzleDB,
  tenantId: string,
  actorId: string,
): Promise<void> {
  await tx
    .insert(roles)
    .values(
      [...new Set(Object.values(DefaultRoles))].map((roleName) => ({
        tenantId,
        scope: 'institute',
        name: { en: roleName },
        abilities: DEFAULT_ROLE_ABILITIES[roleName],
        primaryNavSlugs: [...(DEFAULT_PRIMARY_NAV_SLUGS[roleName] ?? [])],
        isDefault: true,
        createdBy: actorId,
        updatedBy: actorId,
      })),
    )
    .onConflictDoUpdate({
      target: [roles.tenantId, roles.name],
      set: {
        abilities: sql`excluded.abilities`,
        primaryNavSlugs: sql`excluded.primary_nav_slugs`,
        updatedAt: new Date(),
        updatedBy: actorId,
      },
    });
}

/**
 * Brings every institute's existing default roles up to the code's abilities and navigation.
 * Runs on every deploy; it creates no role (institute setup does that).
 */
export async function refreshDefaultRoleAbilities(tx: DrizzleDB, actorId: string): Promise<void> {
  for (const roleName of new Set(Object.values(DefaultRoles))) {
    await tx
      .update(roles)
      .set({
        abilities: DEFAULT_ROLE_ABILITIES[roleName],
        primaryNavSlugs: [...(DEFAULT_PRIMARY_NAV_SLUGS[roleName] ?? [])],
        updatedAt: new Date(),
        updatedBy: actorId,
      })
      .where(
        and(
          eq(roles.scope, 'institute'),
          eq(roles.isDefault, true),
          eq(roles.name, { en: roleName }),
          isNull(roles.deletedAt),
        ),
      );
  }
}
