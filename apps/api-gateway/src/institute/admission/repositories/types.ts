import type { AdmissionApplicationStatus, EnquiryStatus } from '@roviq/common-types';
import type { admissionApplications, enquiries } from '@roviq/database';
import type { toApplicationModel, toEnquiryModel } from '../admission-records';

export type EnquiryRecord = ReturnType<typeof toEnquiryModel>;
export type ApplicationRecord = ReturnType<typeof toApplicationModel>;

type EnquiryInsert = typeof enquiries.$inferInsert;
type ApplicationInsert = typeof admissionApplications.$inferInsert;

export type NewEnquiryData = Omit<
  EnquiryInsert,
  'id' | 'tenantId' | 'enquiryNumber' | 'createdBy' | 'updatedBy'
>;

export interface NewApplicationData {
  enquiryId: string | null;
  academicYearId: string;
  standardId: string;
  /** Omitted: the column default. */
  sectionId?: string | null;
  formData: Record<string, unknown>;
  status: AdmissionApplicationStatus;
  isRteApplication: boolean;
}

export type ApplicationUpdate = Partial<Omit<ApplicationInsert, 'id' | 'tenantId'>>;

export interface EnquiryConversionData {
  enquiryId: string;
  application: NewApplicationData;
  /** The enquiry's status once it points at the new application. */
  enquiryStatus: EnquiryStatus;
}
