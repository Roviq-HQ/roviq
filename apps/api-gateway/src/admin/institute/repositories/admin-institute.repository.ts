import type { AcademicTreeRows, AdminResellerStatusRow } from './types';

/** Platform-scope reads for institute administration; every query runs as `roviq_admin`. */
export abstract class AdminInstituteRepository {
  abstract findReseller(resellerId: string): Promise<AdminResellerStatusRow | null>;
  abstract instituteGroupExists(groupId: string): Promise<boolean>;
  /** Standards, sections and subjects of the institute's most recent academic year. */
  abstract findAcademicTreeRows(instituteId: string): Promise<AcademicTreeRows>;
  /** Board of the primary affiliation: dated rows first, then the oldest. */
  abstract findPrimaryBoard(instituteId: string): Promise<string | undefined>;
}
