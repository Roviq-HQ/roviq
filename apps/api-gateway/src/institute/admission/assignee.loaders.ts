import { Inject, Injectable, Scope } from '@nestjs/common';
import type { InstituteContext } from '@roviq/common-types';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  staffProfilesLive,
  tenantUserProfilesLive,
  withTenant,
} from '@roviq/database';
import DataLoader from 'dataloader';
import { and, eq, inArray } from 'drizzle-orm';
import type { EnquiryAssigneeModel } from './models/enquiry-assignee.model';

/**
 * Enquiry assignees by user id: one query per batch, read under the caller's own tenant, so a
 * user's profile in another institute is never returned. No cache: a subscription keeps one
 * request context for the whole connection, and a cached name would go stale.
 */
@Injectable({ scope: Scope.REQUEST })
export class AssigneeLoaders {
  private loader: DataLoader<string, EnquiryAssigneeModel | null> | null = null;

  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  byUserId(ctx: InstituteContext): DataLoader<string, EnquiryAssigneeModel | null> {
    this.loader ??= new DataLoader<string, EnquiryAssigneeModel | null>(
      async (userIds) => {
        const rows = await withTenant(this.db, ctx, (tx) =>
          tx
            .select({
              userId: tenantUserProfilesLive.userId,
              firstName: tenantUserProfilesLive.firstName,
              lastName: tenantUserProfilesLive.lastName,
              employeeId: staffProfilesLive.employeeId,
            })
            .from(tenantUserProfilesLive)
            .leftJoin(
              staffProfilesLive,
              and(
                eq(staffProfilesLive.userId, tenantUserProfilesLive.userId),
                eq(staffProfilesLive.tenantId, tenantUserProfilesLive.tenantId),
              ),
            )
            .where(inArray(tenantUserProfilesLive.userId, [...new Set(userIds)])),
        );
        const byId = new Map(rows.map((row) => [row.userId, row]));
        return userIds.map((id) => byId.get(id) ?? null);
      },
      { cache: false },
    );
    return this.loader;
  }
}
