import type { FirstAcademicYearData, SectionStrengthNorms, SetupStatus } from './types';

/**
 * Setup writes for an institute being created or approved, as `roviq_admin`: no request
 * context exists in the setup workflow. Every write is idempotent.
 */
export abstract class InstituteSetupRepository {
  /** The default institute roles (admin, principal, teacher, student, parent …). */
  abstract createDefaultRoles(instituteId: string): Promise<void>;
  abstract findFirstAdminUserId(instituteId: string): Promise<string | null>;
  /** The institute's role whose English name is `name`. */
  abstract findRoleIdByName(instituteId: string, name: string): Promise<string | null>;
  /** One config per type, all channels at their defaults; existing rows are kept. */
  abstract createNotificationConfigs(
    instituteId: string,
    notificationTypes: readonly string[],
    actorId: string,
  ): Promise<void>;
  /** Kept when the institute already has one. */
  abstract createInstituteConfig(
    instituteId: string,
    sectionStrengthNorms: SectionStrengthNorms,
    actorId: string,
  ): Promise<void>;
  /** The institute's academic year if it has any, otherwise a new active one. */
  abstract findOrCreateFirstAcademicYear(
    instituteId: string,
    year: FirstAcademicYearData,
    actorId: string,
  ): Promise<string>;
  abstract updateSetupStatus(
    instituteId: string,
    status: SetupStatus,
    actorId: string,
  ): Promise<void>;
}
