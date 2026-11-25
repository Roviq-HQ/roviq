import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import type { AbilityRule, AuthScope } from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import { NOTIFICATION_SUBJECTS } from '@roviq/notifications';
import { REDIS_CLIENT } from '@roviq/redis';
import type Redis from 'ioredis';
import { IdentityRepository } from './repositories/identity.repository';
import { recordTokenVersion } from './token-version-cache';

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
  /** Plaintext temporary password — NEVER stored. Caller may hand this to a delivery channel; default flow ships it inline. */
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
 *    notification-service can deliver the welcome SMS/email by email and SMS.
 *  - Returns the plaintext password for callers that need to surface it
 *    inline (e.g. admin "reset password and show once" flows).
 */
export interface UserContact {
  userId: string;
  email: string;
  username: string;
  mustChangePassword: boolean;
  firstName: string | null;
  lastName: string | null;
  phone: { countryCode: string; number: string } | null;
}

function pickName(name: Record<string, string>): string | null {
  return name.en ?? Object.values(name)[0] ?? null;
}

export type EmailUserResolution =
  | { kind: 'existing'; userId: string; email: string }
  | { kind: 'created'; userId: string; email: string; tempPassword: string }
  | {
      kind: 'unavailable';
      /**
       * Never shown to the caller: each reason would tell them something about an account that
       * is not theirs. `email_unverified`: the address belongs to an account whose owner has not
       * proved they read that mailbox (SF-045).
       */
      reason: 'ambiguous' | 'deleted' | 'username_taken' | 'phone_taken' | 'email_unverified';
    };

@Injectable()
export class IdentityService {
  constructor(
    private readonly repo: IdentityRepository,
    private readonly eventBus: EventBusService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    // private readonly authEventService: AuthEventService, // TODO: Add this back in when we have a way to emit the event
  ) {}

  /**
   * Users whose email equals `email`, ignoring case, soft-deleted ones included: the email
   * stays globally unique after deletion, so a deleted owner still holds it.
   */
  async findUsersByEmail(
    email: string,
  ): Promise<
    { userId: string; isDeleted: boolean; isEmailVerified: boolean; createdBy: string }[]
  > {
    const rows = await this.repo.findUsersByEmail(email);
    return rows.map((r) => ({
      userId: r.id,
      isDeleted: r.deletedAt !== null,
      isEmailVerified: r.emailVerifiedAt !== null,
      createdBy: r.createdBy,
    }));
  }

  /** Whether any user, soft-deleted included, already has this Roviq ID. */
  async isUsernameTaken(username: string): Promise<boolean> {
    return this.repo.usernameExists(username);
  }

  /**
   * Whether a verified phone row holds this number. Only a verified number has one owner; a
   * typed one is contact data and may repeat across users.
   */
  async isPhoneTaken(phone: { countryCode: string; number: string }): Promise<boolean> {
    return this.repo.verifiedPhoneExists(phone);
  }

  /**
   * The account a new membership should attach to, matched by email only: the existing
   * owner of the address, or a new user whose Roviq ID is the address. `unavailable` when
   * the address cannot safely identify one live account.
   */
  async findOrCreateUserByEmail(
    rawEmail: string,
    actorId: string,
    /** Used only when a new user is created; an existing account is never changed. */
    newUser: { phone?: { countryCode: string; number: string } } = {},
  ): Promise<EmailUserResolution> {
    const email = rawEmail.trim().toLowerCase();
    const matches = await this.findUsersByEmail(email);
    if (matches.length > 1) return { kind: 'unavailable', reason: 'ambiguous' };
    const [existing] = matches;
    if (existing?.isDeleted) return { kind: 'unavailable', reason: 'deleted' };
    if (existing) {
      // SECURITY (SF-045): whoever created an account may hold its password (the welcome also
      // goes to the phone they typed), so an unverified address only identifies its owner to
      // the same actor who created it.
      if (!existing.isEmailVerified && existing.createdBy !== actorId) {
        return { kind: 'unavailable', reason: 'email_unverified' };
      }
      return { kind: 'existing', userId: existing.userId, email };
    }
    // Never link by Roviq ID: an unrelated account may use this address as its username.
    if (await this.isUsernameTaken(email)) return { kind: 'unavailable', reason: 'username_taken' };
    if (newUser.phone && (await this.isPhoneTaken(newUser.phone))) {
      return { kind: 'unavailable', reason: 'phone_taken' };
    }
    const created = await this.createUser({
      email,
      username: email,
      phone: newUser.phone,
      actorId,
    });
    return { kind: 'created', userId: created.userId, email, tempPassword: created.tempPassword };
  }

  /**
   * The account-level profile carrying the user's name; an existing profile is left as it is,
   * because only the user edits it. A plain string is stored as the English name.
   */
  async ensureUserProfile(
    userId: string,
    name: {
      firstName: string | Record<string, string>;
      lastName?: string | Record<string, string> | null;
    },
    actorId: string,
  ): Promise<void> {
    const i18n = (value: string | Record<string, string>) =>
      typeof value === 'string' ? { en: value } : value;
    await this.repo.insertUserProfileIfMissing({
      userId,
      firstName: i18n(name.firstName),
      lastName: name.lastName ? i18n(name.lastName) : null,
      actorId,
    });
  }

  /** Email, name and primary phone of a live user; null when the user is gone. */
  async findUserContact(userId: string): Promise<UserContact | null> {
    const user = await this.repo.findUserContact(userId);
    if (!user) return null;
    return {
      userId,
      email: user.email,
      username: user.username,
      mustChangePassword: user.mustChangePassword,
      firstName: user.firstName ? pickName(user.firstName) : null,
      lastName: user.lastName ? pickName(user.lastName) : null,
      phone: user.phone,
    };
  }

  /**
   * True when the account was created by a member of this reseller. Such an account's name
   * and phone were typed by the reseller's own staff; any other account's are not theirs to see.
   */
  async wasCreatedByReseller(userId: string, resellerId: string): Promise<boolean> {
    return this.repo.wasCreatedByReseller(userId, resellerId);
  }

  /**
   * Replaces the password of a user who has never completed a first login with a fresh
   * temporary one and returns it, once. Null when the user has a real password: the check
   * and the write are one statement, so a password set meanwhile is never overwritten.
   */
  async reissueTempPassword(userId: string, actorId: string): Promise<string | null> {
    const tempPassword = randomBytes(16).toString('base64url');
    const passwordHash = await hash(tempPassword);
    // Same three steps as a password change: whoever holds the old temporary password must
    // lose the sessions it opened, not only the password.
    const tokenVersion = await this.repo.replaceTempPassword(userId, passwordHash, actorId);
    if (tokenVersion === null) return null;
    await recordTokenVersion(this.redis, userId, tokenVersion);
    return tempPassword;
  }

  /** The live membership of this user in the institute with this role, if any. */
  async findInstituteMembership(
    userId: string,
    tenantId: string,
    roleId: string,
  ): Promise<{ membershipId: string } | null> {
    const membershipId = await this.repo.findInstituteMembershipId(userId, tenantId, roleId);
    return membershipId !== null ? { membershipId } : null;
  }

  async createUser(input: CreateUserInput): Promise<CreateUserResult> {
    const tempPassword = randomBytes(16).toString('base64url');
    const passwordHash = await hash(tempPassword);

    const userId = await this.repo.insertUser({
      email: input.email,
      username: input.username,
      passwordHash,
      phone: input.phone ?? null,
      actorId: input.actorId,
    });

    return { userId, tempPassword };
  }

  /**
   * Removes an account made moments ago for a person whose institute record then failed to
   * save, so a failed admission leaves no account behind. Only an account nobody has used can
   * go: one with a membership of any scope or a changed password is kept (false).
   */
  async discardNewUser(userId: string): Promise<boolean> {
    return this.repo.deleteUnusedUser(userId);
  }

  async createMembership(input: CreateMembershipInput): Promise<CreateMembershipResult> {
    if (input.scope === 'institute') {
      if (!input.tenantId) throw new Error('tenantId is required for institute-scope membership');
      const membershipId = await this.repo.insertInstituteMembership({
        userId: input.userId,
        tenantId: input.tenantId,
        roleId: input.roleId,
        abilities: input.abilities ?? [],
        actorId: input.actorId,
      });
      return { membershipId, scope: 'institute' };
    }

    if (input.scope === 'reseller') {
      if (!input.resellerId)
        throw new Error('resellerId is required for reseller-scope membership');
      const membershipId = await this.repo.insertResellerMembership({
        userId: input.userId,
        resellerId: input.resellerId,
        roleId: input.roleId,
        abilities: input.abilities ?? [],
        actorId: input.actorId,
      });
      return { membershipId, scope: 'reseller' };
    }

    // platform
    const membershipId = await this.repo.insertPlatformMembership({
      userId: input.userId,
      roleId: input.roleId,
      abilities: input.abilities ?? [],
      actorId: input.actorId,
    });
    return { membershipId, scope: 'platform' };
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
    /** Null when the account has no real address; a placeholder address must never be passed. */
    email: string | null;
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
