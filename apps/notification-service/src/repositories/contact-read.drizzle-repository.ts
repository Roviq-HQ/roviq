import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  deviceTokens,
  deviceTokensLive,
  mkAdminCtx,
  phoneNumbersLive,
  SYSTEM_USER_ID,
  usersLive,
  withAdmin,
} from '@roviq/database';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { ContactReadRepository } from './contact-read.repository';
import type { ContactRecord } from './types';

const ORIGIN = 'repository:notification-contacts';

@Injectable()
export class ContactReadDrizzleRepository extends ContactReadRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async findContact(userId: string): Promise<ContactRecord | null> {
    return withAdmin(this.db, mkAdminCtx(ORIGIN), async (tx) => {
      const [row] = await tx
        .select({
          email: usersLive.email,
          preferredLocale: usersLive.preferredLocale,
          countryCode: phoneNumbersLive.countryCode,
          number: phoneNumbersLive.number,
        })
        .from(usersLive)
        .leftJoin(
          phoneNumbersLive,
          and(eq(phoneNumbersLive.userId, usersLive.id), eq(phoneNumbersLive.isPrimary, true)),
        )
        .where(eq(usersLive.id, userId))
        .limit(1);
      if (!row) return null;
      return {
        email: row.email,
        preferredLocale: row.preferredLocale,
        phone: row.countryCode && row.number ? `${row.countryCode}${row.number}` : null,
      };
    });
  }

  async findDeviceTokens(userId: string): Promise<string[]> {
    const rows = await withAdmin(this.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .select({ token: deviceTokensLive.token })
        .from(deviceTokensLive)
        .where(eq(deviceTokensLive.userId, userId))
        .orderBy(deviceTokensLive.token),
    );
    return rows.map((r) => r.token);
  }

  async retireDeviceToken(token: string): Promise<void> {
    await withAdmin(this.db, mkAdminCtx(ORIGIN), (tx) =>
      tx
        .update(deviceTokens)
        .set({
          deletedAt: new Date(),
          deletedBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
          version: sql`${deviceTokens.version} + 1`,
        })
        .where(and(eq(deviceTokens.token, token), isNull(deviceTokens.deletedAt))),
    );
  }
}
