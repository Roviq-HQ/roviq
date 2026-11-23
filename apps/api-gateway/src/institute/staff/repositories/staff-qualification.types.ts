import type { QualificationType } from '@roviq/common-types';
import type { staffQualifications, staffQualificationsLive } from '@roviq/database';

export type StaffQualificationRow = typeof staffQualificationsLive.$inferSelect;
export type StaffQualificationWriteRow = typeof staffQualifications.$inferSelect;

export interface CreateStaffQualificationData {
  tenantId: string;
  actorId: string;
  staffProfileId: string;
  type: QualificationType;
  degreeName: string;
  institution: string | null;
  boardUniversity: string | null;
  yearOfPassing: number | null;
  gradePercentage: string | null;
  /** Already checked with `FileService.verifyUploads`; made ready with the row. */
  certificateFileId: string | null;
}

/** Changed fields only; an absent key keeps the stored value. */
export interface StaffQualificationPatch {
  type?: QualificationType;
  degreeName?: string;
  institution?: string;
  boardUniversity?: string;
  yearOfPassing?: number;
  gradePercentage?: string;
}

export interface CertificateReplacement {
  /** Already checked with `FileService.verifyUploads`; null removes the scan. */
  newFileId: string | null;
  /** The scan being replaced, marked deleted with the update. */
  previousFileId: string | null;
}

export interface StaffQualificationFileRef {
  id: string;
  certificateFileId: string | null;
}
