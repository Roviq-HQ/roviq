import type { AbilityRule } from '@roviq/common-types';
import {
  botProfiles,
  botProfilesLive,
  type DrizzleDB,
  guardianProfiles,
  guardianProfilesLive,
  memberships,
  membershipsLive,
  roles,
  rolesLive,
  staffProfiles,
  staffProfilesLive,
  studentProfiles,
  studentProfilesLive,
} from '@roviq/database';
import { and, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';

/**
 * What happens to a membership when the profile that uses it is deleted.
 * - `keep`: another profile of the person still uses it, or it has ended already.
 * - `end`: this was its last profile; the membership ends with it.
 * - `own_membership`: the caller would end their own membership.
 * - `needs_full_control`: the member has full control and the caller has not.
 * - `last_admin`: it is the institute's last membership with full control.
 */
export type MembershipEndDecision =
  | 'keep'
  | 'end'
  | 'own_membership'
  | 'needs_full_control'
  | 'last_admin';

/** What restoring a profile does to its membership; `needs_full_control` as above. */
export type MembershipRestoreDecision = 'keep' | 'restore' | 'needs_full_control';

/** A role whose rules include full control of the institute. */
const FULL_CONTROL = sql`'[{"action":"manage","subject":"all"}]'::jsonb`;

/**
 * True when the caller holds full control of the institute through a live, active membership.
 * Read from the database inside the transaction, never from a value the request carries.
 */
async function actorHasFullControl(tx: DrizzleDB, actorId: string): Promise<boolean> {
  const [own] = await tx
    .select({ id: membershipsLive.id })
    .from(membershipsLive)
    .innerJoin(rolesLive, eq(rolesLive.id, membershipsLive.roleId))
    .where(
      and(
        eq(membershipsLive.userId, actorId),
        eq(membershipsLive.status, 'ACTIVE'),
        sql`${rolesLive.abilities} @> ${FULL_CONTROL}`,
      ),
    )
    .limit(1);
  return own !== undefined;
}

async function roleHasFullControl(tx: DrizzleDB, roleId: string): Promise<boolean> {
  const [role] = await tx
    .select({ id: rolesLive.id })
    .from(rolesLive)
    .where(and(eq(rolesLive.id, roleId), sql`${rolesLive.abilities} @> ${FULL_CONTROL}`));
  return role !== undefined;
}

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

  if (await roleHasFullControl(tx, member.roleId)) {
    // Deleting a record is not a way to decide who runs the institute.
    if (!(await actorHasFullControl(tx, actorId))) return 'needs_full_control';
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

/**
 * Ends a membership with its last profile. `at` is the moment written to the profile's own
 * `deleted_at`: the equal stamps are how a restore knows the membership ended this way.
 * A trigger then ends the sessions that were opened with it.
 */
export async function endMembership(
  tx: DrizzleDB,
  params: { membershipId: string; actorId: string; at: Date },
): Promise<void> {
  await tx
    .update(memberships)
    .set({ deletedAt: params.at, deletedBy: params.actorId, updatedBy: params.actorId })
    .where(and(eq(memberships.id, params.membershipId), isNull(memberships.deletedAt)));
}

/**
 * Decides, before a profile is restored, what its membership does. Only a membership that
 * ended with a profile comes back: one of its profiles carries the same `deleted_at`. One the
 * platform ended, or a revoked one, stays as it is.
 */
export async function decideMembershipRestore(
  tx: DrizzleDB,
  params: { membershipId: string; actorId: string },
): Promise<MembershipRestoreDecision> {
  const { membershipId, actorId } = params;
  const [member] = await tx
    .select({ roleId: memberships.roleId, deletedAt: memberships.deletedAt })
    .from(memberships) // allow-base-read: looks at an ended membership
    .where(eq(memberships.id, membershipId))
    .for('update');
  if (!member?.deletedAt) return 'keep';

  let endedWithProfile = false;
  for (const profiles of [studentProfiles, staffProfiles, guardianProfiles, botProfiles]) {
    const [match] = await tx
      .select({ id: profiles.id })
      .from(profiles) // allow-base-read: the deleted profile that ended the membership
      .where(and(eq(profiles.membershipId, membershipId), eq(profiles.deletedAt, member.deletedAt)))
      .limit(1);
    if (match) {
      endedWithProfile = true;
      break;
    }
  }
  if (!endedWithProfile) return 'keep';

  if ((await roleHasFullControl(tx, member.roleId)) && !(await actorHasFullControl(tx, actorId))) {
    return 'needs_full_control';
  }
  return 'restore';
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
  | { kind: 'needs_full_control' }
  | { kind: 'last_admin' }
  | { kind: 'deleted'; membershipEnded: boolean };

/** The outcome of restoring a deleted profile. */
export type RestoreProfileResult = 'restored' | 'not_found' | 'needs_full_control';
