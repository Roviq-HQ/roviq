import { Inject, Injectable } from '@nestjs/common';
import { DefaultRoles } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  guardianProfiles,
  guardianProfilesLive,
  memberships,
  mkInstituteCtx,
  phoneNumbersLive,
  rolesLive,
  softDelete,
  studentGuardianLinks,
  studentGuardianLinksLive,
  studentProfilesLive,
  tenantUserProfilesLive,
  withTenant,
} from '@roviq/database';
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  ensureTenantUserProfile,
  type TenantUserProfileFields,
  updateTenantUserProfile,
} from '../../../auth/tenant-user-profile';
import type { SignInTarget } from '../../sign-in-details/sign-in-details.service';
import { withSignInStates } from '../../sign-in-details/sign-in-status';
import { readSignInTarget } from '../../sign-in-details/sign-in-target';
import { GuardianRepository } from './guardian.repository';
import type {
  CreateGuardianLinkData,
  CreateGuardianLinkResult,
  CreateGuardianMembershipData,
  CreateGuardianProfileData,
  DeletedGuardianRecord,
  GuardianProfilePatch,
  GuardianProfileRow,
  GuardianWithSignIn,
  LinkedStudentRecord,
  LockedGuardianLink,
  StudentGuardianLinkRow,
  UnlinkPlan,
  UpdateGuardianResult,
} from './types';

const ORIGIN = 'service:guardian';

/**
 * Projection for the guardian detail: the institute's copy of name, photo and gender, the
 * primary phone, and the linked-students count as a scalar subquery (no N+1).
 */
function guardianSelect() {
  return {
    id: guardianProfilesLive.id,
    userId: guardianProfilesLive.userId,
    membershipId: guardianProfilesLive.membershipId,
    occupation: guardianProfilesLive.occupation,
    organization: guardianProfilesLive.organization,
    designation: guardianProfilesLive.designation,
    educationLevel: guardianProfilesLive.educationLevel,
    version: guardianProfilesLive.version,
    createdAt: guardianProfilesLive.createdAt,
    updatedAt: guardianProfilesLive.updatedAt,
    firstName: tenantUserProfilesLive.firstName,
    lastName: tenantUserProfilesLive.lastName,
    profileImageFileId: tenantUserProfilesLive.profileImageFileId,
    gender: tenantUserProfilesLive.gender,
    primaryPhone: phoneNumbersLive.number,
    // Cast to int so Drizzle returns `number`, not `string` (PG COUNT returns bigint).
    linkedStudentCount: sql<number>`(
      SELECT COUNT(*)::int
      FROM ${studentGuardianLinksLive}
      WHERE ${studentGuardianLinksLive.guardianProfileId} = ${guardianProfilesLive.id}
    )`.as('linked_student_count'),
  } as const;
}

@Injectable()
export class GuardianDrizzleRepository extends GuardianRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async findById(tenantId: string, id: string): Promise<GuardianWithSignIn | null> {
    const rows = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const found = await tx
        .select(guardianSelect())
        .from(guardianProfilesLive)
        .innerJoin(
          tenantUserProfilesLive,
          and(
            eq(tenantUserProfilesLive.userId, guardianProfilesLive.userId),
            eq(tenantUserProfilesLive.tenantId, guardianProfilesLive.tenantId),
          ),
        )
        .leftJoin(
          phoneNumbersLive,
          and(
            eq(phoneNumbersLive.userId, guardianProfilesLive.userId),
            eq(phoneNumbersLive.isPrimary, true),
          ),
        )
        .where(eq(guardianProfilesLive.id, id))
        .limit(1);
      return withSignInStates(tx, tenantId, found);
    });
    return rows[0] ?? null;
  }

  async findParentRoleId(tenantId: string): Promise<string | null> {
    const guardianRole = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .select({ id: rolesLive.id })
        .from(rolesLive)
        .where(
          and(
            eq(rolesLive.tenantId, tenantId),
            sql`${rolesLive.name}->>'en' = ${DefaultRoles.Parent}`,
          ),
        )
        .limit(1);
    });
    return guardianRole[0]?.id ?? null;
  }

  async createMembership(data: CreateGuardianMembershipData): Promise<{ id: string }> {
    const { tenantId, actorId } = data;
    const inserted = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const rows = await tx
        .insert(memberships)
        .values({
          userId: data.userId,
          tenantId,
          roleId: data.roleId,
          status: 'ACTIVE',
          abilities: [],
          createdBy: actorId,
          updatedBy: actorId,
        })
        .returning({ id: memberships.id });
      await ensureTenantUserProfile(tx, {
        tenantId,
        userId: data.userId,
        actorId,
        ...data.profile,
      });
      return rows;
    });
    return inserted[0];
  }

  async createProfile(data: CreateGuardianProfileData): Promise<GuardianProfileRow> {
    return withTenant(this.db, mkInstituteCtx(data.tenantId, ORIGIN), async (tx) => {
      const rows = await tx
        .insert(guardianProfiles)
        .values({
          userId: data.userId,
          membershipId: data.membershipId,
          tenantId: data.tenantId,
          occupation: data.occupation,
          organization: data.organization,
          educationLevel: data.educationLevel,
          createdBy: data.actorId,
          updatedBy: data.actorId,
        })
        .returning();
      return rows[0];
    });
  }

  async findSignInTarget(tenantId: string, id: string): Promise<SignInTarget | null> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const [profile] = await tx
        .select({ userId: guardianProfilesLive.userId })
        .from(guardianProfilesLive)
        .where(eq(guardianProfilesLive.id, id))
        .limit(1);
      return profile ? readSignInTarget(tx, tenantId, profile.userId) : null;
    });
  }

  async updateProfile(
    tenantId: string,
    id: string,
    actorId: string,
    version: number,
    patch: GuardianProfilePatch,
  ): Promise<UpdateGuardianResult> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      // Separate "not here" (another institute's id included) from a version mismatch.
      const [existing] = await tx
        .select({ id: guardianProfilesLive.id })
        .from(guardianProfilesLive)
        .where(eq(guardianProfilesLive.id, id))
        .limit(1);
      if (!existing) return { kind: 'not_found' } as const;
      const rows = await tx
        .update(guardianProfiles)
        .set({
          ...patch,
          updatedBy: actorId,
          version: sql`${guardianProfiles.version} + 1`,
        })
        .where(and(eq(guardianProfiles.id, id), eq(guardianProfiles.version, version)))
        .returning({ id: guardianProfiles.id, userId: guardianProfiles.userId });
      if (rows.length === 0) return { kind: 'version_mismatch' } as const;
      return { kind: 'ok', userId: rows[0].userId } as const;
    });
  }

  async updateInstituteProfile(
    tenantId: string,
    userId: string,
    actorId: string,
    changes: Partial<TenantUserProfileFields>,
  ): Promise<void> {
    await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), (tx) =>
      updateTenantUserProfile(tx, { tenantId, userId, actorId, changes }),
    );
  }

  async listLinkedStudentIds(tenantId: string, guardianProfileId: string): Promise<string[]> {
    const links = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .select({ studentProfileId: studentGuardianLinksLive.studentProfileId })
        .from(studentGuardianLinksLive)
        .where(eq(studentGuardianLinksLive.guardianProfileId, guardianProfileId));
    });
    return links.map((link) => link.studentProfileId);
  }

  async hasOtherGuardian(
    tenantId: string,
    studentProfileId: string,
    guardianProfileId: string,
  ): Promise<boolean> {
    const otherGuardians = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, ORIGIN),
      async (tx) => {
        // Links to already-deleted guardians do not count as another guardian.
        return tx
          .select({ id: studentGuardianLinksLive.id })
          .from(studentGuardianLinksLive)
          .innerJoin(
            guardianProfilesLive,
            eq(guardianProfilesLive.id, studentGuardianLinksLive.guardianProfileId),
          )
          .where(
            and(
              eq(studentGuardianLinksLive.studentProfileId, studentProfileId),
              sql`${studentGuardianLinksLive.guardianProfileId} != ${guardianProfileId}`,
            ),
          )
          .limit(1);
      },
    );
    return otherGuardians.length > 0;
  }

  async softDelete(tenantId: string, id: string, actorId: string): Promise<boolean> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const rows = await tx
        .update(guardianProfiles)
        .set({ deletedAt: new Date(), deletedBy: actorId })
        .where(and(eq(guardianProfiles.id, id), sql`${guardianProfiles.deletedAt} IS NULL`))
        .returning();
      return rows.length > 0;
    });
  }

  async listDeleted(tenantId: string): Promise<DeletedGuardianRecord[]> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .select({
          id: guardianProfiles.id,
          firstName: tenantUserProfilesLive.firstName,
          lastName: tenantUserProfilesLive.lastName,
          deletedAt: sql<Date>`${guardianProfiles.deletedAt}`.mapWith(guardianProfiles.deletedAt),
        })
        .from(guardianProfiles) // allow-base-read: the Deleted list shows trashed rows
        .innerJoin(
          tenantUserProfilesLive,
          and(
            eq(tenantUserProfilesLive.userId, guardianProfiles.userId),
            eq(tenantUserProfilesLive.tenantId, guardianProfiles.tenantId),
          ),
        )
        .where(isNotNull(guardianProfiles.deletedAt))
        .orderBy(desc(guardianProfiles.deletedAt));
    });
  }

  async restore(tenantId: string, id: string, actorId: string): Promise<boolean> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const rows = await tx
        .update(guardianProfiles)
        .set({ deletedAt: null, deletedBy: null, updatedBy: actorId })
        .where(and(eq(guardianProfiles.id, id), isNotNull(guardianProfiles.deletedAt)))
        .returning({ id: guardianProfiles.id });
      return rows.length > 0;
    });
  }

  async studentExists(tenantId: string, studentProfileId: string): Promise<boolean> {
    const student = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .select({ id: studentProfilesLive.id })
        .from(studentProfilesLive)
        .where(eq(studentProfilesLive.id, studentProfileId))
        .limit(1);
    });
    return student.length > 0;
  }

  async guardianExists(tenantId: string, guardianProfileId: string): Promise<boolean> {
    const guardian = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .select({ id: guardianProfilesLive.id })
        .from(guardianProfilesLive)
        .where(eq(guardianProfilesLive.id, guardianProfileId))
        .limit(1);
    });
    return guardian.length > 0;
  }

  async clearPrimaryContact(
    tenantId: string,
    studentProfileId: string,
    actorId: string,
  ): Promise<void> {
    await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      await tx
        .update(studentGuardianLinks)
        .set({ isPrimaryContact: false, updatedBy: actorId })
        .where(
          and(
            eq(studentGuardianLinks.studentProfileId, studentProfileId),
            eq(studentGuardianLinks.isPrimaryContact, true),
          ),
        );
    });
  }

  async createLink(data: CreateGuardianLinkData): Promise<CreateGuardianLinkResult> {
    try {
      const link = await withTenant(this.db, mkInstituteCtx(data.tenantId, ORIGIN), async (tx) => {
        const rows = await tx
          .insert(studentGuardianLinks)
          .values({
            createdBy: data.actorId,
            updatedBy: data.actorId,
            tenantId: data.tenantId,
            studentProfileId: data.studentProfileId,
            guardianProfileId: data.guardianProfileId,
            relationship: data.relationship,
            isPrimaryContact: data.isPrimaryContact,
            isEmergencyContact: data.isEmergencyContact,
            canPickup: data.canPickup,
            livesWith: data.livesWith,
          })
          .returning();
        return rows[0];
      });
      return { kind: 'ok', link };
    } catch (error) {
      // The unique index refuses a second link of the same pair; the transaction is rolled back.
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('uq_student_guardian')) return { kind: 'already_linked' };
      throw error;
    }
  }

  async unlink(
    tenantId: string,
    studentProfileId: string,
    actorId: string,
    plan: (links: LockedGuardianLink[]) => UnlinkPlan,
  ): Promise<void> {
    await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      // Locks the student's live links so two concurrent unlinks cannot both
      // pass the last-guardian check. A link to a deleted guardian is not a
      // guardian the student still has, so the join drops it.
      const links = await tx
        .select({
          id: studentGuardianLinks.id,
          guardianProfileId: studentGuardianLinks.guardianProfileId,
          isPrimaryContact: studentGuardianLinks.isPrimaryContact,
        })
        .from(studentGuardianLinks) // allow-base-read: FOR UPDATE row lock, filtered to live rows
        .innerJoin(
          guardianProfilesLive,
          eq(guardianProfilesLive.id, studentGuardianLinks.guardianProfileId),
        )
        .where(
          and(
            eq(studentGuardianLinks.studentProfileId, studentProfileId),
            isNull(studentGuardianLinks.deletedAt),
          ),
        )
        .for('update', { of: studentGuardianLinks });

      const { linkId, replacementLinkId } = plan(links);

      // Soft delete first: the one-primary-per-student index ignores deleted rows.
      await softDelete(tx, studentGuardianLinks, linkId);
      if (replacementLinkId) {
        await tx
          .update(studentGuardianLinks)
          .set({ isPrimaryContact: true, updatedBy: actorId })
          .where(eq(studentGuardianLinks.id, replacementLinkId));
      }
    });
  }

  async revokeAccess(
    tenantId: string,
    studentProfileId: string,
    guardianProfileId: string,
    actorId: string,
  ): Promise<StudentGuardianLinkRow | null> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const rows = await tx
        .update(studentGuardianLinks)
        .set({
          canPickup: false,
          isPrimaryContact: false,
          updatedBy: actorId,
        })
        .where(
          and(
            eq(studentGuardianLinks.studentProfileId, studentProfileId),
            eq(studentGuardianLinks.guardianProfileId, guardianProfileId),
            isNull(studentGuardianLinks.deletedAt),
          ),
        )
        .returning();
      return rows[0] ?? null;
    });
  }

  async listLinkedStudents(
    tenantId: string,
    guardianProfileId: string,
  ): Promise<LinkedStudentRecord[]> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .select({
          linkId: studentGuardianLinksLive.id,
          studentProfileId: studentGuardianLinksLive.studentProfileId,
          relationship: studentGuardianLinksLive.relationship,
          isPrimaryContact: studentGuardianLinksLive.isPrimaryContact,
          canPickup: studentGuardianLinksLive.canPickup,
        })
        .from(studentGuardianLinksLive)
        .where(eq(studentGuardianLinksLive.guardianProfileId, guardianProfileId));
    });
  }
}
