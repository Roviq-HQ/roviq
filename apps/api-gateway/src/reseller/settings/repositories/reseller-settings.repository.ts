import type { ResellerContext } from '@roviq/common-types';
import type { resellers } from '@roviq/database';

export type ResellerRecord = typeof resellers.$inferSelect;

export type ResellerSelfPatch = Partial<
  Pick<
    typeof resellers.$inferInsert,
    'name' | 'branding' | 'registrationNumber' | 'registrationState' | 'contact' | 'address'
  >
>;

export interface ResellerCounts {
  instituteCount: number;
  teamSize: number;
}

export abstract class ResellerSettingsRepository {
  abstract findOwn(ctx: ResellerContext): Promise<ResellerRecord | null>;
  /** Null when the stored version is no longer `expectedVersion`. */
  abstract updateOwn(
    ctx: ResellerContext,
    expectedVersion: number,
    patch: ResellerSelfPatch,
  ): Promise<ResellerRecord | null>;
  /** Live institutes and active staff, as the platform's reseller list counts them. */
  abstract countOwn(ctx: ResellerContext): Promise<ResellerCounts>;
}
