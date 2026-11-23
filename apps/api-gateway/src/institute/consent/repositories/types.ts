import type { consentRecords } from '@roviq/database';

export type ConsentRecordRow = typeof consentRecords.$inferSelect;

export interface ConsentWriteData {
  tenantId: string;
  guardianProfileId: string;
  studentProfileId: string;
  purpose: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface ConsentGrantData extends ConsentWriteData {
  verificationMethod: string | null;
}

/** Latest consent row per purpose (and student), as the raw SQL returns it. */
export type LatestConsentRow = {
  student_profile_id: string;
  purpose: string;
  is_granted: boolean;
  created_at: Date;
};
