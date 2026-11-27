import type {
  InstituteAffiliationRecord,
  InstituteBrandingRecord,
  InstituteConfigRecord,
  InstituteIdentifierRecord,
} from './types';

/**
 * The branding, configuration, identifiers and affiliations of one institute, read as the
 * caller's own database role. Row security decides whether the institute is the caller's: an
 * institute that is not answers with nothing.
 */
export abstract class InstituteDetailsRepository {
  abstract findBranding(instituteId: string): Promise<InstituteBrandingRecord | null>;
  abstract findConfig(instituteId: string): Promise<InstituteConfigRecord | null>;
  abstract findIdentifiers(instituteId: string): Promise<InstituteIdentifierRecord[]>;
  abstract findAffiliations(instituteId: string): Promise<InstituteAffiliationRecord[]>;
}
