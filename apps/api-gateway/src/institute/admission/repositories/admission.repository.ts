import type { AdmissionApplicationStatus } from '@roviq/common-types';
import type {
  ApplicationRecord,
  ApplicationUpdate,
  EnquiryConversionData,
  EnquiryRecord,
  NewApplicationData,
  NewEnquiryData,
} from './types';

export abstract class AdmissionRepository {
  /** A live enquiry with the same parent phone and class. */
  abstract hasDuplicateEnquiry(
    tenantId: string,
    parentPhone: string,
    classRequested: string,
  ): Promise<boolean>;
  /** Next `ENQ-000123` number from the institute's `enq_no` sequence, created on first use. */
  abstract nextEnquiryNumber(tenantId: string): Promise<string>;
  abstract createEnquiry(
    tenantId: string,
    actorId: string,
    enquiryNumber: string,
    data: NewEnquiryData,
  ): Promise<EnquiryRecord>;
  /** Null when no enquiry has the id. */
  abstract updateEnquiry(
    tenantId: string,
    id: string,
    updates: Record<string, unknown>,
  ): Promise<EnquiryRecord | null>;
  abstract findEnquiry(tenantId: string, id: string): Promise<EnquiryRecord | null>;
  /** Inserts the application and points the enquiry at it, in one transaction. */
  abstract convertEnquiry(
    tenantId: string,
    actorId: string,
    data: EnquiryConversionData,
  ): Promise<ApplicationRecord>;

  /** Whether the user holds a membership of the institute. */
  abstract userIsMember(tenantId: string, userId: string): Promise<boolean>;
  abstract standardExists(tenantId: string, standardId: string): Promise<boolean>;
  abstract findAcademicYear(
    tenantId: string,
    academicYearId: string,
  ): Promise<{ isActive: boolean } | null>;
  abstract createApplication(
    tenantId: string,
    actorId: string,
    data: NewApplicationData,
  ): Promise<ApplicationRecord>;
  abstract findApplicationStatus(
    tenantId: string,
    id: string,
  ): Promise<AdmissionApplicationStatus | null>;
  /** Writes only while the status is still `expectedStatus`; null when a concurrent writer moved it. */
  abstract updateApplicationIfStatus(
    tenantId: string,
    id: string,
    expectedStatus: AdmissionApplicationStatus,
    updates: ApplicationUpdate,
  ): Promise<ApplicationRecord | null>;
  abstract sectionInStandard(
    tenantId: string,
    sectionId: string,
    standardId: string,
  ): Promise<boolean>;
}
