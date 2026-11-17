import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  mkAdminCtx,
  SYSTEM_USER_ID,
  users,
  usersLive,
  withAdmin,
} from '@roviq/database';
import { eq, sql } from 'drizzle-orm';
import type { CreateUserData, UserRecord } from './types';
import { UserRepository } from './user.repository';

const userSelect = {
  id: usersLive.id,
  username: usersLive.username,
  email: usersLive.email,
  passwordHash: usersLive.passwordHash,
  status: usersLive.status,
  passwordChangedAt: usersLive.passwordChangedAt,
  mustChangePassword: usersLive.mustChangePassword,
} as const;

const userWriteReturning = {
  id: users.id,
  username: users.username,
  email: users.email,
  passwordHash: users.passwordHash,
  status: users.status,
  passwordChangedAt: users.passwordChangedAt,
  mustChangePassword: users.mustChangePassword,
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

  async create(data: CreateUserData): Promise<UserRecord> {
    const [user] = await withAdmin(this.db, mkAdminCtx('repository:user'), (tx) =>
      tx
        .insert(users)
        .values({
          // Self-registration: no acting user exists before this row does.
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
          username: data.username,
          email: data.email,
          passwordHash: data.passwordHash,
        })
        .returning(userWriteReturning),
    );
    return user;
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

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await withAdmin(this.db, mkAdminCtx('repository:user'), (tx) =>
      tx
        .update(users)
        .set({
          passwordHash,
          passwordChangedAt: sql`now()`,
          mustChangePassword: false,
          updatedBy: userId,
        })
        .where(eq(users.id, userId)),
    );
  }
}
