import { Inject, Injectable } from '@nestjs/common';
import type { ResellerContext } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  institutesLive,
  resellerMembershipsLive,
  resellers,
  resellersLive,
  withReseller,
} from '@roviq/database';
import { and, count, eq, sql } from 'drizzle-orm';
import {
  type ResellerCounts,
  type ResellerRecord,
  type ResellerSelfPatch,
  ResellerSettingsRepository,
} from './reseller-settings.repository';

@Injectable()
export class ResellerSettingsDrizzleRepository extends ResellerSettingsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async findOwn(ctx: ResellerContext): Promise<ResellerRecord | null> {
    return withReseller(this.db, ctx, async (tx) => {
      const [row] = await tx
        .select()
        .from(resellersLive)
        .where(eq(resellersLive.id, ctx.resellerId));
      return row ?? null;
    });
  }

  async updateOwn(
    ctx: ResellerContext,
    expectedVersion: number,
    patch: ResellerSelfPatch,
  ): Promise<ResellerRecord | null> {
    return withReseller(this.db, ctx, async (tx) => {
      const [row] = await tx
        .update(resellers)
        .set({
          ...patch,
          updatedAt: new Date(),
          updatedBy: ctx.userId,
          version: sql`${resellers.version} + 1`,
        })
        .where(and(eq(resellers.id, ctx.resellerId), eq(resellers.version, expectedVersion)))
        .returning();
      return row ?? null;
    });
  }

  async countOwn(ctx: ResellerContext): Promise<ResellerCounts> {
    return withReseller(this.db, ctx, async (tx) => {
      const [[institutes], [staff]] = await Promise.all([
        tx
          .select({ value: count() })
          .from(institutesLive)
          .where(eq(institutesLive.resellerId, ctx.resellerId)),
        tx
          .select({ value: count() })
          .from(resellerMembershipsLive)
          .where(
            and(
              eq(resellerMembershipsLive.resellerId, ctx.resellerId),
              eq(resellerMembershipsLive.isActive, true),
            ),
          ),
      ]);
      return { instituteCount: institutes?.value ?? 0, teamSize: staff?.value ?? 0 };
    });
  }
}
