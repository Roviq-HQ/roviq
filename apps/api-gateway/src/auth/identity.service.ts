import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import type { AbilityRule, AuthScope } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  memberships,
  mkAdminCtx,
  mkInstituteCtx,
  mkResellerCtx,
  phoneNumbers,
  platformMemberships,
  resellerMemberships,
  users,
  withAdmin,
  withReseller,
  withTenant,
} from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import { NOTIFICATION_SUBJECTS } from '@roviq/notifications';
import { eq, sql } from 'drizzle-orm';

export interface CreateUserInput {
  /** Email address (placeholder allowed for system-created users without one). */
  email: string;
  /** Roviq ID — must be globally unique. */
  username: string;
  /** Optional initial phone for the user. */
  phone?: { countryCode: string; number: string };
  /** Display name for the welcome message. */
  firstName?: string;
  lastName?: string;
  /** Recorded as created_by — `SYSTEM_USER_ID` for unattended flows. */
  actorId: string;
}

export interface CreateUserResult {
  userId: string;
  /** Plaintext temporary password — NEVER stored. Caller may hand this to a delivery channel; default flow ships it via Novu. */
  tempPassword: string;
}

export interface CreateMembershipInput {
  userId: string;
  scope: AuthScope;
  /** Required for scope='institute'. */
  tenantId?: string;
  /** Required for scope='reseller'. */
  resellerId?: string;
  roleId: string;
  abilities?: AbilityRule[];
  actorId: string;
}

export interface CreateMembershipResult {
  membershipId: string;
  scope: AuthScope;
}

export interface CreateUserWithMembershipInput extends CreateUserInput {
  scope: AuthScope;
  tenantId?: string;
  resellerId?: string;
  roleId: string;
  abilities?: AbilityRule[];
  /** Skip emitting NOTIFICATION.user.created for cases where the caller emits its own welcome (e.g. bulk import sends a single batch notification). */
  skipWelcomeNotification?: boolean;
}

export interface CreateUserWithMembershipResult extends CreateUserResult, CreateMembershipResult {}

/**
 * Owns every write to the `users`, `memberships`, `platform_memberships`, and
 * `reseller_memberships` tables.
 *
 * Per backend-service skill (Identity Service Integration): institute, reseller
 * and admin services MUST NOT insert into these tables directly — they go
 * through this service. Until a separate Identity microservice is split out the
 * service is in-process; the boundary is the public API of this class, not the
 * transport.
 *
 * Behaviour:
 *  - Generates a 128-bit random temp password and Argon2id-hashes it.
 *  - Sets users.must_change_password = true so the first login is forced
 *    through `changePassword` before any other action.
 *  - Emits NOTIFICATION.user.created with the plaintext temp password so the
 *    notification-service can deliver the welcome SMS/email via Novu.
 *  - Returns the plaintext password for callers that need to surface it
 *    inline (e.g. admin "reset password and show once" flows).
 */
export type EmailUserResolution =
  | { kind: 'existing'; userId: string; email: string }
  | { kind: 'created'; userId: string; email: string; tempPassword: string }
  | { kind: 'unavailable'; reason: 'ambiguous' | 'deleted' | 'username_taken' };

@Injectable()
export class IdentityService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDB,
    private readonly eventBus: EventBusService,
    // private readonly authEventService: AuthEventService, // TODO: Add this back in when we have a way to emit the event
  ) {}

  /**
   * Users whose email equals `email`, ignoring case, soft-deleted ones included: the email
   * stays globally unique after deletion, so a deleted owner still holds it.
   */
  async findUsersByEmail(email: string): Promise<{ userId: string; isDeleted: boolean }[]> {
    const rows = await withAdmin(this.db, mkAdminCtx('service:identity'), (tx) =>
      tx
        .select({ id: users.id, deletedAt: users.deletedAt })
        .from(users) // allow-base-read: a soft-deleted user still owns its email
        .where(sql`lower(${users.email}) = lower(${email})`)
        .orderBy(users.id),
    );
    return rows.map((r) => ({ userId: r.id, isDeleted: r.deletedAt !== null }));
  }

  /** Whether any user, soft-deleted included, already has this Roviq ID. */
  async isUsernameTaken(username: string): Promise<boolean> {
    const [row] = await withAdmin(this.db, mkAdminCtx('service:identity'), (tx) =>
      tx
        .select({ id: users.id })
        .from(users) // allow-base-read: a soft-deleted user still owns its username
        .where(eq(users.username, username))
        .limit(1),
    );
    return row !== undefined;
  }

  /**
   * The account a new membership should attach to, matched by email only: the existing
   * owner of the address, or a new user whose Roviq ID is the address. `unavailable` when
   * the address cannot safely identify one live account.
   */
  async findOrCreateUserByEmail(rawEmail: string, actorId: string): Promise<EmailUserResolution> {
    const email = rawEmail.trim().toLowerCase();
    const matches = await this.findUsersByEmail(email);
    if (matches.length > 1) return { kind: 'unavailable', reason: 'ambiguous' };
    const [existing] = matches;
    if (existing?.isDeleted) return { kind: 'unavailable', reason: 'deleted' };
    if (existing) return { kind: 'existing', userId: existing.userId, email };
    // Never link by Roviq ID: an unrelated account may use this address as its username.
    if (await this.isUsernameTaken(email)) return { kind: 'unavailable', reason: 'username_taken' };
    const created = await this.createUser({ email, username: email, actorId });
    return { kind: 'created', userId: created.userId, email, tempPassword: created.tempPassword };
  }

  async createUser(input: CreateUserInput): Promise<CreateUserResult> {
    const tempPassword = randomBytes(16).toString('base64url');
    const passwordHash = await hash(tempPassword);

    const [row] = await withAdmin(this.db, mkAdminCtx('service:identity'), async (tx) => {
      return tx
        .insert(users)
        .values({
          createdBy: input.actorId,
          updatedBy: input.actorId,
          email: input.email,
          username: input.username,
          passwordHash,
          mustChangePassword: true,
        })
        .returning({ id: users.id });
    });

    if (input.phone) {
      const phone = input.phone;
      await withAdmin(this.db, mkAdminCtx('service:identity'), async (tx) => {
        await tx
          .insert(phoneNumbers)
          .values({
            createdBy: input.actorId,
            updatedBy: input.actorId,
            userId: row.id,
            countryCode: phone.countryCode,
            number: phone.number,
            isPrimary: true,
            label: 'personal',
          })
          .onConflictDoNothing();
      });
    }

    return { userId: row.id, tempPassword };
  }

  async createMembership(input: CreateMembershipInput): Promise<CreateMembershipResult> {
    if (input.scope === 'institute') {
      if (!input.tenantId) throw new Error('tenantId is required for institute-scope membership');
      const tenantId = input.tenantId;
      const [row] = await withTenant(
        this.db,
        mkInstituteCtx(tenantId, 'service:identity'),
        async (tx) => {
          return tx
            .insert(memberships)
            .values({
              userId: input.userId,
              tenantId,
              roleId: input.roleId,
              status: 'ACTIVE',
              abilities: input.abilities ?? [],
              createdBy: input.actorId,
              updatedBy: input.actorId,
            })
            .returning({ id: memberships.id });
        },
      );
      return { membershipId: row.id, scope: 'institute' };
    }

    if (input.scope === 'reseller') {
      if (!input.resellerId)
        throw new Error('resellerId is required for reseller-scope membership');
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
              abilities: input.abilities ?? [],
            })
            .returning({ id: resellerMemberships.id });
        },
      );
      return { membershipId: row.id, scope: 'reseller' };
    }

    // platform
    const [row] = await withAdmin(this.db, mkAdminCtx('service:identity'), async (tx) => {
      return tx
        .insert(platformMemberships)
        .values({
          createdBy: input.actorId,
          updatedBy: input.actorId,
          userId: input.userId,
          roleId: input.roleId,
          isActive: true,
          abilities: input.abilities ?? [],
        })
        .returning({ id: platformMemberships.id });
    });
    return { membershipId: row.id, scope: 'platform' };
  }

  async createUserWithMembership(
    input: CreateUserWithMembershipInput,
  ): Promise<CreateUserWithMembershipResult> {
    const userResult = await this.createUser({
      email: input.email,
      username: input.username,
      phone: input.phone,
      firstName: input.firstName,
      lastName: input.lastName,
      actorId: input.actorId,
    });

    const membership = await this.createMembership({
      userId: userResult.userId,
      scope: input.scope,
      tenantId: input.tenantId,
      resellerId: input.resellerId,
      roleId: input.roleId,
      abilities: input.abilities,
      actorId: input.actorId,
    });

    if (!input.skipWelcomeNotification) {
      this.sendWelcomeNotification({
        userId: userResult.userId,
        username: input.username,
        email: input.email,
        phone: input.phone,
        firstName: input.firstName,
        lastName: input.lastName,
        tempPassword: userResult.tempPassword,
        scope: input.scope,
        tenantId: input.tenantId,
        resellerId: input.resellerId,
      });
    }

    return { ...userResult, ...membership };
  }

  /** Welcome message carrying the temp password; for callers that create the user and membership separately. */
  sendWelcomeNotification(payload: {
    userId: string;
    username: string;
    email: string;
    phone?: { countryCode: string; number: string };
    firstName?: string;
    lastName?: string;
    tempPassword: string;
    scope: AuthScope;
    tenantId?: string;
    resellerId?: string;
  }): void {
    this.eventBus.emit(NOTIFICATION_SUBJECTS.USER_CREATED, {
      userId: payload.userId,
      scope: payload.scope,
      tenantId: payload.tenantId ?? null,
      resellerId: payload.resellerId ?? null,
      username: payload.username,
      email: payload.email,
      phone: payload.phone ? `${payload.phone.countryCode}${payload.phone.number}` : null,
      firstName: payload.firstName ?? null,
      lastName: payload.lastName ?? null,
      tempPassword: payload.tempPassword,
      mustChangePassword: true,
    });
  }
}
