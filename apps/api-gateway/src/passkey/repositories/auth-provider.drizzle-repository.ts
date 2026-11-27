import { Inject, Injectable } from '@nestjs/common';
import type { SignedInUser } from '@roviq/common-types';
import {
  authProviders,
  authProvidersLive,
  DRIZZLE_DB,
  type DrizzleDB,
  mkAdminCtx,
  usersLive,
  withAdmin,
  withUser,
} from '@roviq/database';
import { and, count, desc, eq, isNull, ne } from 'drizzle-orm';
import { AuthProviderRepository } from './auth-provider.repository';
import type { AuthProviderRecord, CreatePasskeyData } from './types';

@Injectable()
export class AuthProviderDrizzleRepository extends AuthProviderRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async findPasskeysByUserId(user: SignedInUser): Promise<AuthProviderRecord[]> {
    return withUser(this.db, user, async (tx) => {
      return tx
        .select({
          id: authProvidersLive.id,
          userId: authProvidersLive.userId,
          provider: authProvidersLive.provider,
          providerUserId: authProvidersLive.providerUserId,
          providerData: authProvidersLive.providerData,
          createdAt: authProvidersLive.createdAt,
        })
        .from(authProvidersLive)
        .where(
          and(eq(authProvidersLive.userId, user.userId), eq(authProvidersLive.provider, 'passkey')),
        )
        .orderBy(desc(authProvidersLive.createdAt));
    });
  }

  async findByActiveUsername(username: string): Promise<AuthProviderRecord[]> {
    return withAdmin(this.db, mkAdminCtx('repository:auth-provider'), async (tx) => {
      return tx
        .select({
          id: authProvidersLive.id,
          userId: authProvidersLive.userId,
          provider: authProvidersLive.provider,
          providerUserId: authProvidersLive.providerUserId,
          providerData: authProvidersLive.providerData,
          createdAt: authProvidersLive.createdAt,
        })
        .from(authProvidersLive)
        .innerJoin(usersLive, eq(authProvidersLive.userId, usersLive.id))
        .where(
          and(
            eq(authProvidersLive.provider, 'passkey'),
            eq(usersLive.username, username),
            eq(usersLive.status, 'ACTIVE'),
          ),
        );
    });
  }

  async findByCredentialId(credentialId: string): Promise<AuthProviderRecord | null> {
    return withAdmin(this.db, mkAdminCtx('repository:auth-provider'), async (tx) => {
      const result = await tx
        .select({
          id: authProvidersLive.id,
          userId: authProvidersLive.userId,
          provider: authProvidersLive.provider,
          providerUserId: authProvidersLive.providerUserId,
          providerData: authProvidersLive.providerData,
          createdAt: authProvidersLive.createdAt,
        })
        .from(authProvidersLive)
        .where(
          and(
            eq(authProvidersLive.provider, 'passkey'),
            eq(authProvidersLive.providerUserId, credentialId),
          ),
        )
        .limit(1);

      return result[0] ?? null;
    });
  }

  async create(user: SignedInUser, data: CreatePasskeyData): Promise<AuthProviderRecord> {
    return withUser(this.db, user, async (tx) => {
      const result = await tx
        .insert(authProviders)
        .values({
          createdBy: user.userId,
          updatedBy: user.userId,
          userId: user.userId,
          provider: data.provider,
          providerUserId: data.providerUserId,
          providerData: data.providerData,
        })
        .returning({
          id: authProviders.id,
          userId: authProviders.userId,
          provider: authProviders.provider,
          providerUserId: authProviders.providerUserId,
          providerData: authProviders.providerData,
          createdAt: authProviders.createdAt,
        });

      return result[0];
    });
  }

  async updateProviderData(id: string, data: unknown): Promise<void> {
    await withAdmin(this.db, mkAdminCtx('repository:auth-provider'), async (tx) => {
      await tx.update(authProviders).set({ providerData: data }).where(eq(authProviders.id, id));
    });
  }

  async countOtherPasskeys(user: SignedInUser, excludeId: string): Promise<number> {
    return withUser(this.db, user, async (tx) => {
      const result = await tx
        .select({ count: count() })
        .from(authProvidersLive)
        .where(
          and(
            eq(authProvidersLive.userId, user.userId),
            eq(authProvidersLive.provider, 'passkey'),
            ne(authProvidersLive.id, excludeId),
          ),
        );

      return result[0].count;
    });
  }

  async deletePasskey(user: SignedInUser, id: string): Promise<number> {
    return withUser(this.db, user, async (tx) => {
      const result = await tx
        .update(authProviders)
        .set({ deletedAt: new Date(), deletedBy: user.userId, updatedBy: user.userId })
        .where(
          and(
            eq(authProviders.id, id),
            eq(authProviders.userId, user.userId),
            isNull(authProviders.deletedAt),
          ),
        );

      return result.rowCount ?? 0;
    });
  }
}
