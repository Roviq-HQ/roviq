import { Inject, Injectable } from '@nestjs/common';
import type { FormHelpMode, SignedInUser } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  mkAdminCtx,
  users,
  usersLive,
  withAdmin,
  withUser,
} from '@roviq/database';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { UserRecord } from './types';
import { UserRepository } from './user.repository';

const userSelect = {
  id: users.id,
  username: users.username,
  email: users.email,
  passwordHash: users.passwordHash,
  status: users.status,
  passwordChangedAt: users.passwordChangedAt,
  mustChangePassword: users.mustChangePassword,
  emailVerifiedAt: users.emailVerifiedAt,
  tokenVersion: users.tokenVersion,
} as const;

@Injectable()
export class UserDrizzleRepository extends UserRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async getPreferredLocale(user: SignedInUser): Promise<string | null> {
    const [row] = await withUser(this.db, user, (tx) =>
      tx
        .select({ preferredLocale: usersLive.preferredLocale })
        .from(usersLive)
        .where(eq(usersLive.id, user.userId))
        .limit(1),
    );
    return row?.preferredLocale ?? null;
  }

  async updatePreferredLocale(user: SignedInUser, locale: string | null): Promise<void> {
    await withUser(this.db, user, (tx) =>
      tx
        .update(users)
        .set({ preferredLocale: locale, updatedBy: user.userId })
        .where(eq(users.id, user.userId)),
    );
  }

  async getFormHelpMode(user: SignedInUser): Promise<FormHelpMode | null> {
    const [row] = await withUser(this.db, user, (tx) =>
      tx
        .select({ formHelpMode: users.formHelpMode })
        .from(users) // allow-base-read: form_help_mode is read only by its owner and is not on users_live
        .where(and(eq(users.id, user.userId), isNull(users.deletedAt)))
        .limit(1),
    );
    return row?.formHelpMode ?? null;
  }

  async updateFormHelpMode(user: SignedInUser, mode: FormHelpMode): Promise<void> {
    await withUser(this.db, user, (tx) =>
      tx
        .update(users)
        .set({ formHelpMode: mode, updatedBy: user.userId })
        .where(and(eq(users.id, user.userId), isNull(users.deletedAt))),
    );
  }

  async findOwn(user: SignedInUser): Promise<UserRecord | null> {
    const [row] = await withUser(this.db, user, (tx) =>
      tx
        .select(userSelect)
        .from(users) // allow-base-read: password_hash and token_version are not on users_live (ROV-279)
        .where(and(eq(users.id, user.userId), isNull(users.deletedAt)))
        .limit(1),
    );
    return row ?? null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const [user] = await withAdmin(this.db, mkAdminCtx('repository:user'), (tx) =>
      tx
        .select(userSelect)
        .from(users) // allow-base-read: password_hash and token_version are not on users_live (ROV-279)
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .limit(1),
    );
    return user ?? null;
  }

  async findByUsername(username: string): Promise<UserRecord | null> {
    const [user] = await withAdmin(this.db, mkAdminCtx('repository:user'), (tx) =>
      tx
        .select(userSelect)
        .from(users) // allow-base-read: password_hash and token_version are not on users_live (ROV-279)
        .where(and(eq(users.username, username), isNull(users.deletedAt)))
        .limit(1),
    );
    return user ?? null;
  }

  async updatePasswordHash(id: string, passwordHash: string, changedAt: Date): Promise<void> {
    await withAdmin(this.db, mkAdminCtx('repository:user'), (tx) =>
      tx
        .update(users)
        .set({ passwordHash, passwordChangedAt: changedAt, updatedBy: id })
        .where(eq(users.id, id)),
    );
  }

  async updatePassword(user: SignedInUser, passwordHash: string): Promise<number> {
    const [row] = await withUser(this.db, user, (tx) =>
      tx
        .update(users)
        .set({
          passwordHash,
          passwordChangedAt: sql`now()`,
          mustChangePassword: false,
          tokenVersion: sql`${users.tokenVersion} + 1`,
          updatedBy: user.userId,
        })
        .where(eq(users.id, user.userId))
        .returning({ tokenVersion: users.tokenVersion }),
    );
    if (!row) throw new Error(`User ${user.userId} not found while updating the password`);
    return row.tokenVersion;
  }

  async markEmailVerified(user: SignedInUser): Promise<void> {
    await withUser(this.db, user, (tx) =>
      tx
        .update(users)
        .set({ emailVerifiedAt: sql`now()`, updatedBy: user.userId })
        .where(eq(users.id, user.userId)),
    );
  }
}
