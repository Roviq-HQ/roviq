import { Inject, Injectable } from '@nestjs/common';
import type { DevicePlatform } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  deviceTokens,
  deviceTokensLive,
  mkAdminCtx,
  withAdmin,
} from '@roviq/database';
import { desc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import { DeviceTokenRepository } from './device-token.repository';

/** Oldest-seen devices beyond this are retired when a new one registers. */
export const MAX_DEVICE_TOKENS_PER_USER = 10;

@Injectable()
export class DeviceTokenDrizzleRepository extends DeviceTokenRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  // device_tokens grants nothing to request roles, so every caller scope writes as the platform role.
  private run<T>(fn: (tx: DrizzleDB) => Promise<T>): Promise<T> {
    return withAdmin(this.db, mkAdminCtx('repository:device-token'), fn);
  }

  async register(userId: string, token: string, platform: DevicePlatform): Promise<void> {
    await this.run(async (tx) => {
      const [existing] = await tx
        .select({ id: deviceTokensLive.id, userId: deviceTokensLive.userId })
        .from(deviceTokensLive)
        .where(eq(deviceTokensLive.token, token))
        .limit(1);

      if (existing?.userId === userId) {
        await tx
          .update(deviceTokens)
          .set({
            platform,
            lastSeenAt: sql`now()`,
            updatedBy: userId,
            version: sql`${deviceTokens.version} + 1`,
          })
          .where(eq(deviceTokens.id, existing.id));
        return;
      }

      // The device changed hands: the previous owner must stop receiving on it.
      if (existing) await this.retire(tx, userId, eq(deviceTokens.id, existing.id));

      await tx
        .insert(deviceTokens)
        .values({ userId, token, platform, createdBy: userId, updatedBy: userId });

      const surplus = await tx
        .select({ id: deviceTokensLive.id })
        .from(deviceTokensLive)
        .where(eq(deviceTokensLive.userId, userId))
        .orderBy(desc(deviceTokensLive.lastSeenAt), desc(deviceTokensLive.id))
        .offset(MAX_DEVICE_TOKENS_PER_USER);
      if (surplus.length > 0) {
        await this.retire(
          tx,
          userId,
          inArray(
            deviceTokens.id,
            surplus.map((row) => row.id),
          ),
        );
      }
    });
  }

  async unregister(userId: string, token: string): Promise<void> {
    await this.run((tx) =>
      this.retire(
        tx,
        userId,
        sql`${eq(deviceTokens.token, token)} AND ${eq(deviceTokens.userId, userId)}`,
      ),
    );
  }

  private async retire(tx: DrizzleDB, actorId: string, which: SQL): Promise<void> {
    await tx
      .update(deviceTokens)
      .set({
        deletedAt: sql`now()`,
        deletedBy: actorId,
        updatedBy: actorId,
        version: sql`${deviceTokens.version} + 1`,
      })
      .where(sql`${which} AND ${isNull(deviceTokens.deletedAt)}`);
  }
}
