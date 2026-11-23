import { Inject, Injectable } from '@nestjs/common';
import type { AdmissionApplicationStatus } from '@roviq/common-types';
import {
  academicYearsLive,
  admissionApplications,
  admissionApplicationsLive,
  DRIZZLE_DB,
  type DrizzleDB,
  enquiries,
  enquiriesLive,
  mkInstituteCtx,
  sectionsLive,
  standardsLive,
  tenantSequences,
  withTenant,
} from '@roviq/database';
import { and, eq, sql } from 'drizzle-orm';
import { toApplicationModel, toEnquiryModel } from '../admission-records';
import { AdmissionRepository } from './admission.repository';
import type {
  ApplicationRecord,
  ApplicationUpdate,
  EnquiryConversionData,
  EnquiryRecord,
  NewApplicationData,
  NewEnquiryData,
} from './types';

const ORIGIN = 'service:admission';

@Injectable()
export class AdmissionDrizzleRepository extends AdmissionRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {
    super();
  }

  async hasDuplicateEnquiry(
    tenantId: string,
    parentPhone: string,
    classRequested: string,
  ): Promise<boolean> {
    const duplicates = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .select({ id: enquiriesLive.id })
        .from(enquiriesLive)
        .where(
          and(
            eq(enquiriesLive.parentPhone, parentPhone),
            eq(enquiriesLive.classRequested, classRequested),
          ),
        )
        .limit(1);
    });
    return duplicates.length > 0;
  }

  nextEnquiryNumber(tenantId: string): Promise<string> {
    return withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      await tx
        .insert(tenantSequences)
        .values({
          tenantId,
          sequenceName: 'enq_no',
          currentValue: 0n,
          formatTemplate: 'ENQ-{value:06d}',
        })
        .onConflictDoNothing();
      const result = await tx.execute(
        sql`SELECT * FROM next_sequence_value(${tenantId}::uuid, 'enq_no')`,
      );
      const row = result.rows[0] as { next_val: string; formatted: string };
      return row.formatted || `ENQ-${row.next_val}`;
    });
  }

  async createEnquiry(
    tenantId: string,
    actorId: string,
    enquiryNumber: string,
    data: NewEnquiryData,
  ): Promise<EnquiryRecord> {
    const rows = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .insert(enquiries)
        .values({
          tenantId,
          enquiryNumber,
          ...data,
          createdBy: actorId,
          updatedBy: actorId,
        })
        .returning();
    });
    return toEnquiryModel(rows[0]);
  }

  async updateEnquiry(
    tenantId: string,
    id: string,
    updates: Record<string, unknown>,
  ): Promise<EnquiryRecord | null> {
    const rows = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx.update(enquiries).set(updates).where(eq(enquiries.id, id)).returning();
    });
    return rows[0] ? toEnquiryModel(rows[0]) : null;
  }

  async findEnquiry(tenantId: string, id: string): Promise<EnquiryRecord | null> {
    const rows = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx.select().from(enquiriesLive).where(eq(enquiriesLive.id, id)).limit(1);
    });
    return rows[0] ? toEnquiryModel(rows[0]) : null;
  }

  async convertEnquiry(
    tenantId: string,
    actorId: string,
    data: EnquiryConversionData,
  ): Promise<ApplicationRecord> {
    const appRows = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      const apps = await tx
        .insert(admissionApplications)
        .values({ tenantId, ...data.application, createdBy: actorId, updatedBy: actorId })
        .returning();

      await tx
        .update(enquiries)
        .set({
          status: data.enquiryStatus,
          convertedToApplicationId: apps[0].id,
          updatedBy: actorId,
        })
        .where(eq(enquiries.id, data.enquiryId));

      return apps;
    });
    return toApplicationModel(appRows[0]);
  }

  async standardExists(tenantId: string, standardId: string): Promise<boolean> {
    const standardRows = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .select({ id: standardsLive.id })
        .from(standardsLive)
        .where(eq(standardsLive.id, standardId))
        .limit(1);
    });
    return standardRows.length > 0;
  }

  async findAcademicYear(
    tenantId: string,
    academicYearId: string,
  ): Promise<{ isActive: boolean } | null> {
    const yearRows = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .select({ id: academicYearsLive.id, isActive: academicYearsLive.isActive })
        .from(academicYearsLive)
        .where(eq(academicYearsLive.id, academicYearId))
        .limit(1);
    });
    return yearRows[0] ? { isActive: yearRows[0].isActive } : null;
  }

  async createApplication(
    tenantId: string,
    actorId: string,
    data: NewApplicationData,
  ): Promise<ApplicationRecord> {
    const rows = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .insert(admissionApplications)
        .values({ tenantId, ...data, createdBy: actorId, updatedBy: actorId })
        .returning();
    });
    return toApplicationModel(rows[0]);
  }

  async findApplicationStatus(
    tenantId: string,
    id: string,
  ): Promise<AdmissionApplicationStatus | null> {
    const current = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .select({ status: admissionApplicationsLive.status })
        .from(admissionApplicationsLive)
        .where(eq(admissionApplicationsLive.id, id))
        .limit(1);
    });
    return current[0]?.status ?? null;
  }

  async updateApplicationIfStatus(
    tenantId: string,
    id: string,
    expectedStatus: AdmissionApplicationStatus,
    updates: ApplicationUpdate,
  ): Promise<ApplicationRecord | null> {
    const rows = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .update(admissionApplications)
        .set(updates)
        .where(
          and(eq(admissionApplications.id, id), eq(admissionApplications.status, expectedStatus)),
        )
        .returning();
    });
    return rows[0] ? toApplicationModel(rows[0]) : null;
  }

  async sectionInStandard(
    tenantId: string,
    sectionId: string,
    standardId: string,
  ): Promise<boolean> {
    const section = await withTenant(this.db, mkInstituteCtx(tenantId, ORIGIN), async (tx) => {
      return tx
        .select({ id: sectionsLive.id })
        .from(sectionsLive)
        .where(and(eq(sectionsLive.id, sectionId), eq(sectionsLive.standardId, standardId)))
        .limit(1);
    });
    return section.length > 0;
  }
}
