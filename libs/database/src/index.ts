export { BaseRepository } from './base-repository';
export { ROVIQ_DIRECT_RESELLER_ID, SYSTEM_USER_ID } from './constants';
export { DatabaseModule } from './database.module';
export { escapeLikePattern, i18nDisplay, i18nLocaleEquals, i18nNameSearch } from './i18n';
export { refreshInstituteDefaultRoles } from './institute-default-roles';
export { RoviqDrizzleLogger } from './logger';
export {
  mapUniqueViolation,
  pgErrorCode,
  type UniqueViolationErrors,
  uniqueViolationConstraint,
} from './pg-errors';
export { createDrizzleDb, DRIZZLE_DB, type DrizzleDB } from './providers';
export {
  provisionResellerSystemRoles,
  RESELLER_SYSTEM_ROLE_ABILITIES,
  RESELLER_SYSTEM_ROLE_NAMES,
  type ResellerSystemRoleName,
} from './reseller-system-roles';
export * from './schema';
export {
  entityPolicies,
  roviqAdmin,
  roviqApp,
  roviqReseller,
  roviqUser,
  selfPolicies,
  tenantPolicies,
} from './schema/common/rls-policies';
export { relations } from './schema/relations';
export {
  admissionSeriesName,
  formatSequenceValue,
  LEGACY_ADMISSION_SEQUENCE,
  MAX_SEQUENCE_VALUE,
  parseSequenceValue,
  resolveAdmissionPrefix,
  resolveAdmissionYear,
  sequenceLiteralPrefix,
} from './sequences/admission-number';
export { notDeleted, restoreDeleted, softDelete } from './soft-delete';
export { isValidTenantId } from './tenant-context';
export {
  mkAdminCtx,
  mkInstituteCtx,
  mkResellerCtx,
  type OwnAccountAccess,
  withAdmin,
  withReseller,
  withTenant,
  withUser,
} from './tenant-db';
