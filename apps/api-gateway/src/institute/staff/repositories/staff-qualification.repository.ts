import type {
  CertificateReplacement,
  CreateStaffQualificationData,
  StaffQualificationFileRef,
  StaffQualificationPatch,
  StaffQualificationRow,
  StaffQualificationWriteRow,
} from './staff-qualification.types';

export abstract class StaffQualificationRepository {
  /** Ordered by type, then degree name. */
  abstract listForStaff(tenantId: string, staffProfileId: string): Promise<StaffQualificationRow[]>;
  abstract staffExists(tenantId: string, staffProfileId: string): Promise<boolean>;
  abstract findLive(tenantId: string, id: string): Promise<StaffQualificationFileRef | null>;
  /** Inserts the row and makes its certificate ready, in one transaction. */
  abstract create(data: CreateStaffQualificationData): Promise<StaffQualificationWriteRow>;
  /**
   * Updates the row and swaps its certificate in one transaction; throws
   * STAFF_QUALIFICATION_NOT_FOUND (rolling back the file changes) when the row is gone.
   */
  abstract update(
    tenantId: string,
    id: string,
    actorId: string,
    patch: StaffQualificationPatch,
    certificate: CertificateReplacement | null,
  ): Promise<StaffQualificationWriteRow>;
  /** Soft-deletes the row together with its certificate. */
  abstract softDelete(
    tenantId: string,
    id: string,
    actorId: string,
    certificateFileId: string | null,
  ): Promise<void>;
}
