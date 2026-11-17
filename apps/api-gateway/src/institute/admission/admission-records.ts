import type { admissionApplications, enquiries } from '@roviq/database';
import type { InferSelectModel } from 'drizzle-orm';
import type { ApplicationModel } from './models/application.model';
import type { EnquiryModel } from './models/enquiry.model';

type EnquiryRow = InferSelectModel<typeof enquiries>;
type ApplicationRow = InferSelectModel<typeof admissionApplications>;

export function toEnquiryModel(row: EnquiryRow): EnquiryModel & { createdBy: string } {
  return {
    id: row.id,
    createdBy: row.createdBy,
    tenantId: row.tenantId,
    enquiryNumber: row.enquiryNumber,
    studentName: row.studentName,
    dateOfBirth: row.dateOfBirth,
    gender: row.gender,
    classRequested: row.classRequested,
    academicYearId: row.academicYearId,
    parentName: row.parentName,
    parentPhone: row.parentPhone,
    parentEmail: row.parentEmail,
    parentRelation: row.parentRelation,
    source: row.source,
    referredBy: row.referredBy,
    assignedTo: row.assignedTo,
    previousSchool: row.previousSchool,
    previousBoard: row.previousBoard,
    siblingInSchool: row.siblingInSchool ?? false,
    siblingAdmissionNo: row.siblingAdmissionNo,
    specialNeeds: row.specialNeeds,
    notes: row.notes,
    status: row.status,
    followUpDate: row.followUpDate,
    lastContactedAt: row.lastContactedAt,
    convertedToApplicationId: row.convertedToApplicationId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toApplicationModel(row: ApplicationRow): ApplicationModel & { createdBy: string } {
  return {
    id: row.id,
    createdBy: row.createdBy,
    tenantId: row.tenantId,
    enquiryId: row.enquiryId,
    academicYearId: row.academicYearId,
    standardId: row.standardId,
    sectionId: row.sectionId,
    formData: row.formData,
    status: row.status,
    isRteApplication: row.isRteApplication,
    testScore: row.testScore,
    interviewScore: row.interviewScore,
    meritRank: row.meritRank,
    rteLotteryRank: row.rteLotteryRank,
    offeredAt: row.offeredAt,
    offerExpiresAt: row.offerExpiresAt,
    offerAcceptedAt: row.offerAcceptedAt,
    rejectionReason: row.rejectionReason,
    rejectedAt: row.rejectedAt,
    studentProfileId: row.studentProfileId,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
