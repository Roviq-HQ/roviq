import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { DEFAULT_ROLE_ABILITIES } from '@roviq/common-types';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { SYSTEM_USER_ID } from '../../constants';
import type { DrizzleDB } from '../../providers';
import { institutes, resellers, roles } from '../../schema';
import { refreshAllInstituteDefaultRoles } from '../essential/institute-roles';
import { makeSeedTestDb } from './seed-test-helpers';

class Rollback extends Error {}

const { pool, db } = makeSeedTestDb();
const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
const STALE = [{ action: 'read' as const, subject: 'all' as const }];

afterAll(async () => {
  await pool.end();
});

/** Runs `fn` on the superuser connection and always rolls back. */
async function inRolledBackTx(fn: (tx: DrizzleDB) => Promise<void>): Promise<void> {
  await db
    .transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    })
    .catch((err: unknown) => {
      if (!(err instanceof Rollback)) throw err;
    });
}

async function createInstitute(tx: DrizzleDB): Promise<string> {
  const suffix = randomUUID().slice(0, 8);
  const [reseller] = await tx
    .insert(resellers)
    .values({ name: `ROV-217 ${suffix}`, slug: `rov-217-${suffix}`, ...BY })
    .returning({ id: resellers.id });
  assert(reseller);
  const [institute] = await tx
    .insert(institutes)
    .values({
      name: { en: `ROV-217 ${suffix}` },
      slug: `rov-217-${suffix}`,
      resellerId: reseller.id,
      ...BY,
    })
    .returning({ id: institutes.id });
  assert(institute);
  return institute.id;
}

describe('refreshAllInstituteDefaultRoles (ROV-217)', () => {
  it('should bring a stale default role to the code and leave a custom role alone', async () => {
    await inRolledBackTx(async (tx) => {
      const tenantId = await createInstitute(tx);
      await tx.insert(roles).values([
        { tenantId, name: { en: 'librarian' }, abilities: STALE, isDefault: true, ...BY },
        // Same name as a default role, but the institute made it its own.
        { tenantId, name: { en: 'nurse' }, abilities: STALE, isDefault: false, ...BY },
      ]);

      await refreshAllInstituteDefaultRoles(tx);

      const abilitiesOf = async (name: string) => {
        const [row] = await tx
          .select({ abilities: roles.abilities })
          .from(roles)
          .where(and(eq(roles.tenantId, tenantId), eq(roles.name, { en: name })));
        return row?.abilities;
      };
      expect(await abilitiesOf('librarian')).toEqual(DEFAULT_ROLE_ABILITIES.librarian);
      expect(await abilitiesOf('nurse')).toEqual(STALE);
      // A deploy creates no role: setup does.
      const created = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.tenantId, tenantId));
      expect(created).toHaveLength(2);
    });
  });

  it('should keep the navigation an institute chose and leave an up-to-date role untouched', async () => {
    await inRolledBackTx(async (tx) => {
      const tenantId = await createInstitute(tx);
      const before = new Date('2026-01-01T00:00:00Z');
      await tx.insert(roles).values([
        {
          tenantId,
          name: { en: 'librarian' },
          abilities: STALE,
          primaryNavSlugs: ['dashboard'],
          isDefault: true,
          ...BY,
        },
        {
          tenantId,
          name: { en: 'nurse' },
          abilities: DEFAULT_ROLE_ABILITIES.nurse,
          isDefault: true,
          updatedAt: before,
          ...BY,
        },
      ]);

      await refreshAllInstituteDefaultRoles(tx);

      const rows = await tx
        .select({ name: roles.name, nav: roles.primaryNavSlugs, updatedAt: roles.updatedAt })
        .from(roles)
        .where(eq(roles.tenantId, tenantId));
      const byName = new Map(rows.map((row) => [row.name.en, row]));
      expect(byName.get('librarian')?.nav).toEqual(['dashboard']);
      expect(byName.get('nurse')?.updatedAt).toEqual(before);
    });
  });
});
