import { Inject, Injectable, Scope } from '@nestjs/common';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  filesLive,
  mkAdminCtx,
  mkInstituteCtx,
  mkResellerCtx,
  withAdmin,
  withReseller,
  withTenant,
} from '@roviq/database';
import { getRequestContext } from '@roviq/request-context';
import DataLoader from 'dataloader';
import { and, eq, inArray } from 'drizzle-orm';
import { fileLiveColumns } from './repositories/file-columns';
import type { FileRecord } from './repositories/types';

/**
 * Loads READY files by id for field resolvers, one query per request. It runs as the caller's
 * own database role, so RLS decides which files exist for them: an id from another institute
 * resolves to null.
 */
@Injectable({ scope: Scope.REQUEST })
export class FileLoaders {
  readonly readyById: DataLoader<string, FileRecord | null>;

  constructor(@Inject(DRIZZLE_DB) db: DrizzleDB) {
    this.readyById = new DataLoader<string, FileRecord | null>(async (ids) => {
      const unique = [...new Set(ids)];
      const query = (tx: DrizzleDB) =>
        tx
          .select(fileLiveColumns)
          .from(filesLive)
          .where(and(inArray(filesLive.id, unique), eq(filesLive.status, 'READY')));
      const { scope, tenantId, resellerId } = getRequestContext();
      let rows: FileRecord[] = [];
      if (scope === 'institute' && tenantId) {
        rows = await withTenant(db, mkInstituteCtx(tenantId, 'loader:file'), query);
      } else if (scope === 'reseller' && resellerId) {
        rows = await withReseller(db, mkResellerCtx(resellerId, 'loader:file'), query);
      } else if (scope === 'platform') {
        rows = await withAdmin(db, mkAdminCtx('loader:file'), query);
      }
      const byId = new Map(rows.map((row) => [row.id, row]));
      return ids.map((id) => byId.get(id) ?? null);
    });
  }
}
