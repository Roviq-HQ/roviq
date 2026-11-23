import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  memberships,
  membershipsLive,
  mkAdminCtx,
  mkInstituteCtx,
  mkResellerCtx,
  phoneNumbers,
  phoneNumbersLive,
  platformMemberships,
  refreshTokens,
  resellerMemberships,
  resellerMembershipsLive,
  userProfiles,
  userProfilesLive,
  users,
  usersLive,
  withAdmin,
  withReseller,
  withTenant,
} from '@roviq/database';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { ensureTenantUserProfile } from '../tenant-user-profile';
import { IdentityRepository } from './identity.repository';
import type {
  NewInstituteMembership,
  NewPlatformMembership,
  NewResellerMembership,
  NewUserPhone,
  NewUserProfile,
  NewUserRecord,
  UserContactRow,
  UserEmailMatch,
} from './types';

@Injectable()
export class IdentityDrizzleRepository extends IdentityRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async findUsersByEmail(email: string): Promise<UserEmailMatch[]> {
    return withAdmin(this.db, mkAdminCtx('service:identity'), (tx) =>
      tx
        .select({
          id: users.id,
          deletedAt: users.deletedAt,
          emailVerifiedAt: users.emailVerifiedAt,
          createdBy: users.createdBy,
        })
        .from(users) // allow-base-read: a soft-deleted user still owns its email
        .where(sql`lower(${users.email}) = lower(${email})`)
        .orderBy(users.id),
    );
  }

  async usernameExists(username: string): Promise<boolean> {
    const [row] = await withAdmin(this.db, mkAdminCtx('service:identity'), (tx) =>
      tx
        .select({ id: users.id })
        .from(users) // allow-base-read: a soft-deleted user still owns its username
        .where(eq(users.username, username))
        .limit(1),
    );
    return row !== undefined;
  }

  async verifiedPhoneExists(phone: { countryCode: string; number: string }): Promise<boolean> {
    const [row] = await withAdmin(this.db, mkAdminCtx('service:identity'), (tx) =>
      tx
        .select({ id: phoneNumbersLive.id })
        .from(phoneNumbersLive)
        .where(
          and(
            eq(phoneNumbersLive.countryCode, phone.countryCode),
            eq(phoneNumbersLive.number, phone.number),
            eq(phoneNumbersLive.isVerified, true),
          ),
        )
        .limit(1),
    );
    return row !== undefined;
  }

  async insertUserProfileIfMissing(profile: NewUserProfile): Promise<void> {
    await withAdmin(this.db, mkAdminCtx('service:identity'), (tx) =>
      tx
        .insert(userProfiles)
        .values({
          userId: profile.userId,
          firstName: profile.firstName,
          lastName: profile.lastName,
          createdBy: profile.actorId,
          updatedBy: profile.actorId,
        })
        .onConflictDoNothing(),
    );
  }

  async findUserContact(userId: string): Promise<UserContactRow | null> {
    return withAdmin(this.db, mkAdminCtx('service:identity'), async (tx) => {
      const [user] = await tx
        .select({
          email: usersLive.email,
          username: usersLive.username,
          mustChangePassword: usersLive.mustChangePassword,
          firstName: userProfilesLive.firstName,
          lastName: userProfilesLive.lastName,
        })
        .from(usersLive)
        .leftJoin(userProfilesLive, eq(userProfilesLive.userId, usersLive.id))
        .where(eq(usersLive.id, userId))
        .limit(1);
      if (!user) return null;
      const [phone] = await tx
        .select({ countryCode: phoneNumbersLive.countryCode, number: phoneNumbersLive.number })
        .from(phoneNumbersLive)
        .where(eq(phoneNumbersLive.userId, userId))
        .orderBy(desc(phoneNumbersLive.isPrimary), asc(phoneNumbersLive.createdAt))
        .limit(1);
      return { ...user, phone: phone ?? null };
    });
  }

  async wasCreatedByReseller(userId: string, resellerId: string): Promise<boolean> {
    const rows = await withAdmin(this.db, mkAdminCtx('service:identity'), (tx) =>
      tx
        .select({ id: usersLive.id })
        .from(usersLive)
        .innerJoin(resellerMembershipsLive, eq(resellerMembershipsLive.userId, usersLive.createdBy))
        .where(and(eq(usersLive.id, userId), eq(resellerMembershipsLive.resellerId, resellerId)))
        .limit(1),
    );
    return rows.length > 0;
  }

  async replaceTempPassword(
    userId: string,
    passwordHash: string,
    actorId: string,
  ): Promise<number | null> {
    return withAdmin(this.db, mkAdminCtx('service:identity'), async (tx) => {
      const [row] = await tx
        .update(users)
        .set({
          passwordHash,
          mustChangePassword: true,
          tokenVersion: sql`${users.tokenVersion} + 1`,
          updatedBy: actorId,
        })
        .where(
          and(eq(users.id, userId), eq(users.mustChangePassword, true), isNull(users.deletedAt)),
        )
        .returning({ tokenVersion: users.tokenVersion });
      if (!row) return null;
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date(), revokedReason: 'password_change' })
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
      return row.tokenVersion;
    });
  }

  async findInstituteMembershipId(
    userId: string,
    tenantId: string,
    roleId: string,
  ): Promise<string | null> {
    const [row] = await withTenant(this.db, mkInstituteCtx(tenantId, 'service:identity'), (tx) =>
      tx
        .select({ id: membershipsLive.id })
        .from(membershipsLive)
        .where(
          and(
            eq(membershipsLive.userId, userId),
            eq(membershipsLive.tenantId, tenantId),
            eq(membershipsLive.roleId, roleId),
          ),
        )
        .limit(1),
    );
    return row ? row.id : null;
  }

  async insertUser(user: NewUserRecord): Promise<string> {
    const [row] = await withAdmin(this.db, mkAdminCtx('service:identity'), async (tx) => {
      return tx
        .insert(users)
        .values({
          createdBy: user.actorId,
          updatedBy: user.actorId,
          email: user.email,
          username: user.username,
          passwordHash: user.passwordHash,
          mustChangePassword: true,
        })
        .returning({ id: users.id });
    });
    return row.id;
  }

  async insertPrimaryPhone(phone: NewUserPhone): Promise<void> {
    await withAdmin(this.db, mkAdminCtx('service:identity'), async (tx) => {
      await tx
        .insert(phoneNumbers)
        .values({
          createdBy: phone.actorId,
          updatedBy: phone.actorId,
          userId: phone.userId,
          countryCode: phone.countryCode,
          number: phone.number,
          isPrimary: true,
          label: 'personal',
        })
        .onConflictDoNothing();
    });
  }

  async insertInstituteMembership(input: NewInstituteMembership): Promise<string> {
    const tenantId = input.tenantId;
    const [row] = await withTenant(
      this.db,
      mkInstituteCtx(tenantId, 'service:identity'),
      async (tx) => {
        const [membership] = await tx
          .insert(memberships)
          .values({
            userId: input.userId,
            tenantId,
            roleId: input.roleId,
            status: 'ACTIVE',
            abilities: input.abilities,
            createdBy: input.actorId,
            updatedBy: input.actorId,
          })
          .returning({ id: memberships.id });
        // The institute's own copy of the person's name starts from the account name.
        const [account] = await tx
          .select({
            firstName: userProfilesLive.firstName,
            lastName: userProfilesLive.lastName,
          })
          .from(userProfilesLive)
          .where(eq(userProfilesLive.userId, input.userId))
          .limit(1);
        if (account) {
          await ensureTenantUserProfile(tx, {
            tenantId,
            userId: input.userId,
            actorId: input.actorId,
            firstName: account.firstName,
            lastName: account.lastName,
          });
        }
        return [membership];
      },
    );
    return row.id;
  }

  async insertResellerMembership(input: NewResellerMembership): Promise<string> {
    const resellerId = input.resellerId;
    const [row] = await withReseller(
      this.db,
      mkResellerCtx(resellerId, 'service:identity'),
      async (tx) => {
        return tx
          .insert(resellerMemberships)
          .values({
            createdBy: input.actorId,
            updatedBy: input.actorId,
            userId: input.userId,
            resellerId,
            roleId: input.roleId,
            isActive: true,
            abilities: input.abilities,
          })
          .returning({ id: resellerMemberships.id });
      },
    );
    return row.id;
  }

  async insertPlatformMembership(input: NewPlatformMembership): Promise<string> {
    const [row] = await withAdmin(this.db, mkAdminCtx('service:identity'), async (tx) => {
      return tx
        .insert(platformMemberships)
        .values({
          createdBy: input.actorId,
          updatedBy: input.actorId,
          userId: input.userId,
          roleId: input.roleId,
          isActive: true,
          abilities: input.abilities,
        })
        .returning({ id: platformMemberships.id });
    });
    return row.id;
  }
}
