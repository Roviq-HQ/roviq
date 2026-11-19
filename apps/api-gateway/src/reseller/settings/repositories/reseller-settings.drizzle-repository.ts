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
import { markFilesDeleted, markFilesReady } from '../../../files/file-attachment';
import {
  type ResellerCounts,
  type ResellerFileChanges,
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
    fileChanges?: ResellerFileChanges,
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
      // Nothing was saved, so no file may change state either.
      if (!row || !fileChanges) return row ?? null;
      for (const { fileId, purpose } of fileChanges.attach) {
        await markFilesReady(tx, { fileIds: [fileId], purpose, userId: ctx.userId });
      }
      await markFilesDeleted(tx, { fileIds: fileChanges.detach, userId: ctx.userId });
      return row;
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
