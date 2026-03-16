import { DEFAULT_ROLE_ABILITIES, DefaultRoles } from '@roviq/common-types';
import { type DrizzleDB, roles, SYSTEM_USER_ID, withAdmin } from '@roviq/database';
import { and, eq } from 'drizzle-orm';

export async function seedDefaultRoles(db: DrizzleDB, tenantId: string): Promise<void> {
  await withAdmin(db, async (tx) => {
    for (const [, roleName] of Object.entries(DefaultRoles)) {
      const abilities = DEFAULT_ROLE_ABILITIES[roleName];

      const [existing] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.tenantId, tenantId), eq(roles.name, { en: roleName })))
        .limit(1);

      if (existing) continue;

      await tx.insert(roles).values({
        tenantId,
        name: { en: roleName },
        abilities: abilities as unknown[],
        isDefault: true,
        createdBy: SYSTEM_USER_ID,
        updatedBy: SYSTEM_USER_ID,
      });
    }
  });
}
