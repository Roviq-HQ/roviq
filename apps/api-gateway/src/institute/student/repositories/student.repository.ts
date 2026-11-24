import type { AcademicStatus, AppAbility, UserDocumentType } from '@roviq/common-types';
import type { TenantUserProfileFields } from '../../../auth/tenant-user-profile';
import type { AdmitStudentData, AdmitStudentResult } from './admit-student';
import type {
  AdmissionClassData,
  AdmissionClassResult,
  DeletedStudentRecord,
  FileRecord,
  NewStudentDocumentData,
  RestoreStudentResult,
  StudentStatusRecord,
  UserDocumentRecord,
} from './types';

export abstract class StudentRepository {
  /** Reads the year, class and section under the institute and checks they belong together. */
  abstract checkAdmissionClass(
    tenantId: string,
    data: AdmissionClassData,
  ): Promise<AdmissionClassResult>;
  /**
   * Membership, the institute's profile copy, student profile with its admission number, and
   * enrolment, in one transaction: nothing is written unless all of it is.
   */
  abstract admit(data: AdmitStudentData): Promise<AdmitStudentResult>;

  /** The student's user id, when the ability's read rules cover the student. */
  abstract findReadableUserId(
    tenantId: string,
    studentProfileId: string,
    ability: AppAbility,
  ): Promise<string | null>;
  /** Marks the files READY, inserts the document and links its files, as admin in one transaction. */
  abstract createDocument(
    data: NewStudentDocumentData,
  ): Promise<{ document: UserDocumentRecord; files: FileRecord[] }>;
  /** The document's type, when it belongs to a student the ability may read. */
  abstract findReadableDocumentType(
    tenantId: string,
    documentId: string,
    ability: AppAbility,
  ): Promise<UserDocumentType | null>;
  /** False when the document was already gone. */
  abstract removeDocument(documentId: string, actorId: string): Promise<boolean>;

  abstract findProfileIdByMembership(
    tenantId: string,
    membershipId: string,
  ): Promise<string | null>;
  abstract findStatus(tenantId: string, id: string): Promise<StudentStatusRecord | null>;
  abstract exists(tenantId: string, id: string): Promise<boolean>;
  /** Optimistic: false when no live row has `expectedVersion`. */
  abstract updateProfile(
    tenantId: string,
    id: string,
    expectedVersion: number,
    updates: Record<string, unknown>,
  ): Promise<boolean>;
  abstract setStatus(
    tenantId: string,
    id: string,
    updates: Record<string, unknown>,
  ): Promise<boolean>;
  /** Changes the institute's profile copy of the student; nothing when the student is gone. */
  abstract updateTenantProfile(
    tenantId: string,
    id: string,
    actorId: string,
    changes: Partial<TenantUserProfileFields>,
  ): Promise<void>;
  /** Whether the student sits in the active year with a status not in `leftStatuses`. */
  abstract hasActiveEnrollment(
    tenantId: string,
    id: string,
    leftStatuses: AcademicStatus[],
  ): Promise<boolean>;
  abstract softDelete(tenantId: string, id: string): Promise<void>;
  abstract listDeleted(tenantId: string): Promise<DeletedStudentRecord[]>;
  abstract restore(tenantId: string, id: string, actorId: string): Promise<RestoreStudentResult>;
}
