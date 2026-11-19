import type { FilePurpose, ResellerContext } from '@roviq/common-types';
import type { resellers } from '@roviq/database';

export type ResellerRecord = typeof resellers.$inferSelect;

export type ResellerSelfPatch = Partial<
  Pick<
    typeof resellers.$inferInsert,
    | 'name'
    | 'branding'
    | 'logoFileId'
    | 'faviconFileId'
    | 'registrationNumber'
    | 'registrationState'
    | 'contact'
    | 'address'
  >
>;

/** Files that change hands in the same transaction as the reseller row. */
export interface ResellerFileChanges {
  /** Verified uploads that become READY with this save. */
  attach: { fileId: string; purpose: FilePurpose }[];
  /** Replaced or removed files. */
  detach: string[];
}

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
    files?: ResellerFileChanges,
  ): Promise<ResellerRecord | null>;
  /** Live institutes and active staff, as the platform's reseller list counts them. */
  abstract countOwn(ctx: ResellerContext): Promise<ResellerCounts>;
}
