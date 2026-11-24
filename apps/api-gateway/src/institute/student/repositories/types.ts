import type {
  AcademicStatus,
  FilePurpose,
  PromotionStatus,
  UserDocumentType,
} from '@roviq/common-types';
import type {
  I18nContent,
  SectionStrengthNorms,
  studentProfiles,
  userDocuments,
} from '@roviq/database';
import type { FileRecord } from '../../../files/repositories/types';

export type { SectionStrengthNorms };

type StudentProfileInsert = typeof studentProfiles.$inferInsert;

export type NewStudentProfileData = Required<
  Pick<
    StudentProfileInsert,
    | 'userId'
    | 'membershipId'
    | 'admissionDate'
    | 'admissionClass'
    | 'admissionType'
    | 'academicStatus'
    | 'socialCategory'
    | 'caste'
    | 'isMinority'
    | 'minorityType'
    | 'isBpl'
    | 'isCwsn'
    | 'cwsnType'
    | 'isRteAdmitted'
    | 'rteCertificate'
    | 'previousSchoolName'
    | 'previousSchoolBoard'
    | 'previousSchoolUdise'
    | 'incomingTcNumber'
    | 'incomingTcDate'
  >
> & {
  /** Picks the admission-number series. */
  standardId: string;
  actorId: string;
};

/** The year, class and section a new student is admitted to. */
export interface AdmissionClassData {
  academicYearId: string;
  standardId: string;
  sectionId: string;
}

export type AdmissionClassResult = { kind: 'year_not_found' } | ClassLookupFailure | { kind: 'ok' };

export interface StudentStatusRecord {
  academicStatus: AcademicStatus;
  tcIssued: boolean;
}

export type UserDocumentRecord = typeof userDocuments.$inferSelect;

export interface NewStudentDocumentData {
  userId: string;
  actorId: string;
  type: UserDocumentType;
  description: string | null;
  referenceNumber: string | null;
  fileIds: string[];
  filePurpose: FilePurpose;
}

export interface DeletedStudentRecord {
  id: string;
  firstName: I18nContent;
  lastName: I18nContent | null;
  identifier: string;
  deletedAt: Date;
}

export type RestoreStudentResult =
  | { kind: 'not_found' }
  | { kind: 'admission_number_taken'; admissionNumber: string }
  | { kind: 'restored' };

// ── Student academics ─────────────────────────────────────

export interface StudentAcademicHistoryRecord {
  id: string;
  studentProfileId: string;
  academicYearId: string;
  academicYearLabel: string;
  isCurrentYear: boolean;
  standardId: string;
  standardName: Record<string, string> | null;
  sectionId: string;
  sectionName: Record<string, string> | null;
  rollNumber: string | null;
  promotionStatus: PromotionStatus | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EnrolTargetData {
  studentProfileId: string;
  academicYearId: string;
  standardId: string;
  sectionId: string;
}

export type ClassLookupFailure = { kind: 'standard_not_found' } | { kind: 'section_not_found' };

export type EnrolTargetResult =
  | { kind: 'student_not_found' }
  | { kind: 'year_not_found' }
  | ClassLookupFailure
  | { kind: 'ok' };

export interface SectionCapacityRecord {
  section: { currentStrength: number; capacity: number | null };
  /** Null when the institute has no config row or no norms in it. */
  norms: SectionStrengthNorms | null;
}

export interface StudentAcademicPlacementRecord {
  id: string;
  sectionId: string;
  studentProfileId: string;
}

export interface ClassChangeRecord {
  id: string;
  studentProfileId: string;
  academicYearId: string;
  standardId: string;
  sectionId: string;
}

export interface PreviousYearResultRecord {
  id: string;
  promotionStatus: PromotionStatus | null;
  numericOrder: number;
}

export interface PreviousYearResultUpdate {
  promotionStatus: PromotionStatus;
  promotedToStandardId: string | null;
}

/** Rules the service applies inside the class-change transaction; each may throw to roll back. */
export interface ClassChangeRules {
  assertPlacementChanges(row: ClassChangeRecord): void;
  assertCapacity(capacity: SectionCapacityRecord): void;
  /** Null leaves last year's result as it is. */
  previousYearResult(
    previous: PreviousYearResultRecord,
    newStandard: { id: string; numericOrder: number },
  ): PreviousYearResultUpdate | null;
}

export interface ChangeClassData {
  studentAcademicId: string;
  standardId: string;
  sectionId: string;
  actorId: string;
}

export type ChangeClassResult =
  | { kind: 'academic_not_found' }
  | ClassLookupFailure
  | { kind: 'ok'; row: ClassChangeRecord };

export interface RemovedPlacementRecord {
  id: string;
  studentProfileId: string;
  academicYearId: string;
  sectionId: string;
  membershipId: string;
}

export type RemoveFromYearResult =
  | { kind: 'not_found' }
  | { kind: 'has_records' }
  | { kind: 'removed'; row: RemovedPlacementRecord };

export interface PromotionDecisionData {
  ids: string[];
  status: PromotionStatus;
  /** Every result but PROMOTED forgets the target standard. */
  clearPromotedTo: boolean;
  actorId: string;
}

export type { FileRecord };
