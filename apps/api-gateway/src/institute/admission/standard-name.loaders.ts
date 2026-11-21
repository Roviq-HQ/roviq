import { Inject, Injectable, Scope } from '@nestjs/common';
import type { InstituteContext } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  type I18nContent,
  standardsLive,
  withTenant,
} from '@roviq/database';
import DataLoader from 'dataloader';
import { inArray } from 'drizzle-orm';

/** Standard names by id, one query per request, read under the caller's own tenant. */
@Injectable({ scope: Scope.REQUEST })
export class StandardNameLoaders {
  private loader: DataLoader<string, I18nContent | null> | null = null;

  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  byId(ctx: InstituteContext): DataLoader<string, I18nContent | null> {
    this.loader ??= new DataLoader<string, I18nContent | null>(async (ids) => {
      const rows = await withTenant(this.db, ctx, (tx) =>
        tx
          .select({ id: standardsLive.id, name: standardsLive.name })
          .from(standardsLive)
          .where(inArray(standardsLive.id, [...new Set(ids)])),
      );
      const byId = new Map(rows.map((row) => [row.id, row.name]));
      return ids.map((id) => byId.get(id) ?? null);
    });
    return this.loader;
  }
}
