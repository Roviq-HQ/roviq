import type { AbilityRule } from '@roviq/common-types';
import {
  botProfilesLive,
  type DrizzleDB,
  guardianProfilesLive,
  memberships,
  roles,
  rolesLive,
  staffProfilesLive,
  studentProfilesLive,
} from '@roviq/database';
import { and, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';

/**
 * What happens to a membership when the profile that uses it is deleted.
 * - `keep`: another profile of the person still uses it, or it has ended already.
 * - `end`: this was its last profile; the membership ends with it.
 * - `own_membership`: the caller would end their own membership.
 * - `last_admin`: it is the institute's last membership with full control.
 */
export type MembershipEndDecision = 'keep' | 'end' | 'own_membership' | 'last_admin';

/** A role whose rules include full control of the institute. */
const FULL_CONTROL = sql`'[{"action":"manage","subject":"all"}]'::jsonb`;

/**
 * Decides, before the profile is deleted, what its membership does. Run inside the same
 * `withTenant` transaction as the delete: the membership row is locked until it commits.
 */
export async function decideMembershipEnd(
  tx: DrizzleDB,
  params: { membershipId: string; profileId: string; actorId: string },
): Promise<MembershipEndDecision> {
  const { membershipId, profileId, actorId } = params;
  const [member] = await tx
    .select({ userId: memberships.userId, roleId: memberships.roleId })
    .from(memberships) // allow-base-read: FOR UPDATE needs the table, not the view
    .where(and(eq(memberships.id, membershipId), isNull(memberships.deletedAt)))
    .for('update');
  if (!member) return 'keep';

  // Profile ids are unique across the four tables, so one id excludes the profile being deleted.
  for (const profiles of [
    studentProfilesLive,
    staffProfilesLive,
    guardianProfilesLive,
    botProfilesLive,
  ]) {
    const [other] = await tx
      .select({ id: profiles.id })
      .from(profiles)
      .where(and(eq(profiles.membershipId, membershipId), ne(profiles.id, profileId)))
      .limit(1);
    if (other) return 'keep';
  }

  if (member.userId === actorId) return 'own_membership';

  const [fullControl] = await tx
    .select({ id: rolesLive.id })
    .from(rolesLive)
    .where(and(eq(rolesLive.id, member.roleId), sql`${rolesLive.abilities} @> ${FULL_CONTROL}`));
  if (fullControl) {
    const others = await tx
      .select({ id: memberships.id })
      .from(memberships) // allow-base-read: FOR UPDATE needs the table, not the view
      .innerJoin(roles, eq(roles.id, memberships.roleId)) // allow-base-read: joined to the locked table
      .where(
        and(
          ne(memberships.id, membershipId),
          isNull(memberships.deletedAt),
          isNull(roles.deletedAt),
          eq(memberships.status, 'ACTIVE'),
          sql`${roles.abilities} @> ${FULL_CONTROL}`,
        ),
      )
      .for('update', { of: memberships });
    if (others.length === 0) return 'last_admin';
  }
  return 'end';
}

/** Ends a membership. A trigger then ends the sessions that were opened with it. */
export async function endMembership(
  tx: DrizzleDB,
  params: { membershipId: string; actorId: string },
): Promise<void> {
  await tx
    .update(memberships)
    .set({ deletedAt: new Date(), deletedBy: params.actorId, updatedBy: params.actorId })
    .where(and(eq(memberships.id, params.membershipId), isNull(memberships.deletedAt)));
}

/**
 * Brings back the membership of a restored profile: the same row, so everything that refers
 * to it (attendance, marks, leave, timetable) still does. Does nothing when it never ended.
 */
export async function restoreMembership(
  tx: DrizzleDB,
  params: { membershipId: string; actorId: string },
): Promise<void> {
  await tx
    .update(memberships)
    .set({ deletedAt: null, deletedBy: null, updatedBy: params.actorId })
    .where(and(eq(memberships.id, params.membershipId), isNotNull(memberships.deletedAt)));
}

/**
 * Gives a user a membership of the institute in a role. The only place that inserts one: when
 * the person held this role before and the membership ended, that same row comes back, so
 * everything that refers to it still does and the unique rule on (user, institute, role) holds.
 * A membership that is still live is left to that unique rule, as before.
 */
export async function insertOrRestoreMembership(
  tx: DrizzleDB,
  params: {
    userId: string;
    tenantId: string;
    roleId: string;
    abilities: AbilityRule[];
    actorId: string;
  },
): Promise<string> {
  const { userId, tenantId, roleId, abilities, actorId } = params;
  const [ended] = await tx
    .select({ id: memberships.id })
    .from(memberships) // allow-base-read: looks for the ended membership to bring back
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.tenantId, tenantId),
        eq(memberships.roleId, roleId),
        isNotNull(memberships.deletedAt),
      ),
    )
    .for('update');
  if (ended) {
    await tx
      .update(memberships)
      .set({ deletedAt: null, deletedBy: null, status: 'ACTIVE', abilities, updatedBy: actorId })
      .where(eq(memberships.id, ended.id));
    return ended.id;
  }
  const [created] = await tx
    .insert(memberships)
    .values({
      userId,
      tenantId,
      roleId,
      status: 'ACTIVE',
      abilities,
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning({ id: memberships.id });
  return created.id;
}

/** The outcome of deleting a student, staff or guardian profile. */
export type DeleteProfileResult =
  | { kind: 'not_found' }
  | { kind: 'own_membership' }
  | { kind: 'last_admin' }
  | { kind: 'deleted'; membershipEnded: boolean };

/** The outcome of restoring a deleted profile. */
export type RestoreProfileResult = 'restored' | 'not_found';
