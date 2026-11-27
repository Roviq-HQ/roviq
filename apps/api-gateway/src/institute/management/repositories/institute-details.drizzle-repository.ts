import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  instituteAffiliationsLive,
  instituteBrandingLive,
  instituteConfigsLive,
  instituteIdentifiersLive,
  mkAdminCtx,
  mkInstituteCtx,
  mkResellerCtx,
  withAdmin,
  withReseller,
  withTenant,
} from '@roviq/database';
import { getRequestContext } from '@roviq/request-context';
import { eq } from 'drizzle-orm';
import { InstituteDetailsRepository } from './institute-details.repository';
import type {
  InstituteAffiliationRecord,
  InstituteBrandingRecord,
  InstituteConfigRecord,
  InstituteIdentifierRecord,
} from './types';

const ORIGIN = 'repository:institute-details';

@Injectable()
export class InstituteDetailsDrizzleRepository extends InstituteDetailsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  /** Runs `query` as the caller's own role; a request with no scope reads nothing. */
  private asCaller<T>(query: (tx: DrizzleDB) => Promise<T>, nothing: T): Promise<T> {
    const { scope, tenantId, resellerId } = getRequestContext();
    if (scope === 'institute' && tenantId) {
      return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), query);
    }
    if (scope === 'reseller' && resellerId) {
      return withReseller(this.db, mkResellerCtx(resellerId, ORIGIN), query);
    }
    if (scope === 'platform') return withAdmin(this.db, mkAdminCtx(ORIGIN), query);
    return Promise.resolve(nothing);
  }

  findBranding(instituteId: string): Promise<InstituteBrandingRecord | null> {
    return this.asCaller(async (tx) => {
      const [row] = await tx
        .select({
          id: instituteBrandingLive.id,
          logoFileId: instituteBrandingLive.logoFileId,
          faviconFileId: instituteBrandingLive.faviconFileId,
          coverImageFileId: instituteBrandingLive.coverImageFileId,
          primaryColor: instituteBrandingLive.primaryColor,
          secondaryColor: instituteBrandingLive.secondaryColor,
          themeIdentifier: instituteBrandingLive.themeIdentifier,
        })
        .from(instituteBrandingLive)
        .where(eq(instituteBrandingLive.tenantId, instituteId));
      return row ?? null;
    }, null);
  }

  findConfig(instituteId: string): Promise<InstituteConfigRecord | null> {
    return this.asCaller(async (tx) => {
      const [row] = await tx
        .select({
          id: instituteConfigsLive.id,
          attendanceType: instituteConfigsLive.attendanceType,
          openingTime: instituteConfigsLive.openingTime,
          closingTime: instituteConfigsLive.closingTime,
          shifts: instituteConfigsLive.shifts,
          notificationPreferences: instituteConfigsLive.notificationPreferences,
          payrollConfig: instituteConfigsLive.payrollConfig,
          gradingSystem: instituteConfigsLive.gradingSystem,
          termStructure: instituteConfigsLive.termStructure,
          sectionStrengthNorms: instituteConfigsLive.sectionStrengthNorms,
          admissionNumberConfig: instituteConfigsLive.admissionNumberConfig,
        })
        .from(instituteConfigsLive)
        .where(eq(instituteConfigsLive.tenantId, instituteId));
      return row ?? null;
    }, null);
  }

  findIdentifiers(instituteId: string): Promise<InstituteIdentifierRecord[]> {
    return this.asCaller(
      (tx) =>
        tx
          .select({
            id: instituteIdentifiersLive.id,
            type: instituteIdentifiersLive.type,
            value: instituteIdentifiersLive.value,
            issuingAuthority: instituteIdentifiersLive.issuingAuthority,
            validFrom: instituteIdentifiersLive.validFrom,
            validTo: instituteIdentifiersLive.validTo,
          })
          .from(instituteIdentifiersLive)
          .where(eq(instituteIdentifiersLive.tenantId, instituteId)),
      [],
    );
  }

  findAffiliations(instituteId: string): Promise<InstituteAffiliationRecord[]> {
    return this.asCaller(
      (tx) =>
        tx
          .select({
            id: instituteAffiliationsLive.id,
            board: instituteAffiliationsLive.board,
            affiliationStatus: instituteAffiliationsLive.affiliationStatus,
            affiliationNumber: instituteAffiliationsLive.affiliationNumber,
            grantedLevel: instituteAffiliationsLive.grantedLevel,
            validFrom: instituteAffiliationsLive.validFrom,
            validTo: instituteAffiliationsLive.validTo,
            nocNumber: instituteAffiliationsLive.nocNumber,
            nocDate: instituteAffiliationsLive.nocDate,
          })
          .from(instituteAffiliationsLive)
          .where(eq(instituteAffiliationsLive.tenantId, instituteId)),
      [],
    );
  }
}
