import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  guardianProfilesLive,
  mkInstituteCtx,
  staffProfilesLive,
  studentProfilesLive,
  withTenant,
} from '@roviq/database';
import { getRequestContext } from '@roviq/request-context';
import { eq } from 'drizzle-orm';

export type PersonKind = 'student' | 'staff' | 'guardian';

/**
 * Finds the user behind a student, staff or guardian profile of the caller's institute. Reads
 * run under RLS, so a profile id from another institute resolves to null: this lookup is the
 * ownership check before the shared user profile is written.
 */
@Injectable()
export class ProfilePhotoTargetRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  async findUserId(kind: PersonKind, profileId: string): Promise<string | null> {
    const { tenantId } = getRequestContext();
    if (!tenantId) throw new Error('Tenant context is required');
    return withTenant(this.db, mkInstituteCtx(tenantId, 'repository:profile-photo'), async (tx) => {
      const view = {
        student: studentProfilesLive,
        staff: staffProfilesLive,
        guardian: guardianProfilesLive,
      }[kind];
      const rows = await tx
        .select({ userId: view.userId })
        .from(view)
        .where(eq(view.id, profileId));
      return rows[0]?.userId ?? null;
    });
  }
}
