import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  mkAdminCtx,
  users,
  usersLive,
  withAdmin,
} from '@roviq/database';
import { eq, sql } from 'drizzle-orm';
import type { UserRecord } from './types';
import { UserRepository } from './user.repository';

const userSelect = {
  id: usersLive.id,
  username: usersLive.username,
  email: usersLive.email,
  passwordHash: usersLive.passwordHash,
  status: usersLive.status,
  passwordChangedAt: usersLive.passwordChangedAt,
  mustChangePassword: usersLive.mustChangePassword,
  emailVerifiedAt: usersLive.emailVerifiedAt,
  tokenVersion: usersLive.tokenVersion,
} as const;

@Injectable()
export class UserDrizzleRepository extends UserRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async getPreferredLocale(userId: string): Promise<string | null> {
    const [user] = await withAdmin(this.db, mkAdminCtx('repository:user'), (tx) =>
      tx
        .select({ preferredLocale: usersLive.preferredLocale })
        .from(usersLive)
        .where(eq(usersLive.id, userId))
        .limit(1),
    );
    return user?.preferredLocale ?? null;
  }

  async updatePreferredLocale(userId: string, locale: string | null): Promise<void> {
    await withAdmin(this.db, mkAdminCtx('repository:user'), (tx) =>
      tx
        .update(users)
        .set({ preferredLocale: locale, updatedBy: userId })
        .where(eq(users.id, userId)),
    );
  }

  async findById(id: string): Promise<UserRecord | null> {
    const [user] = await withAdmin(this.db, mkAdminCtx('repository:user'), (tx) =>
      tx.select(userSelect).from(usersLive).where(eq(usersLive.id, id)).limit(1),
    );
    return user ?? null;
  }

  async findByUsername(username: string): Promise<UserRecord | null> {
    const [user] = await withAdmin(this.db, mkAdminCtx('repository:user'), (tx) =>
      tx.select(userSelect).from(usersLive).where(eq(usersLive.username, username)).limit(1),
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

  async updatePassword(userId: string, passwordHash: string): Promise<number> {
    const [row] = await withAdmin(this.db, mkAdminCtx('repository:user'), (tx) =>
      tx
        .update(users)
        .set({
          passwordHash,
          passwordChangedAt: sql`now()`,
          mustChangePassword: false,
          tokenVersion: sql`${users.tokenVersion} + 1`,
          updatedBy: userId,
        })
        .where(eq(users.id, userId))
        .returning({ tokenVersion: users.tokenVersion }),
    );
    if (!row) throw new Error(`User ${userId} not found while updating the password`);
    return row.tokenVersion;
  }

  async markEmailVerified(userId: string): Promise<void> {
    await withAdmin(this.db, mkAdminCtx('repository:user'), (tx) =>
      tx
        .update(users)
        .set({ emailVerifiedAt: sql`now()`, updatedBy: userId })
        .where(eq(users.id, userId)),
    );
  }
}
