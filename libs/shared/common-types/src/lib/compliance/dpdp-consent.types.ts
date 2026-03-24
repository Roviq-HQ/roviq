/**
 * DPDP Act (Digital Personal Data Protection) consent interfaces (ROV-140, PRD 15.5).
 *
 * India's Digital Personal Data Protection Act, 2023.
 * Deadline for full compliance: May 2027.
 *
 * Key requirements:
 * - Verifiable parental consent for under-18 student data
 * - Purpose-limited collection (every field has documented purpose)
 * - Right to erasure via soft delete + audit trail
 * - Breach notification within 72 hours to Data Protection Board
 */

/**
 * Consent status for a data principal (student/parent/guardian).
 *
 * - 'pending': consent has been requested but not yet acted upon
 * - 'granted': data principal has explicitly granted consent
 * - 'withdrawn': data principal has exercised right to withdraw consent
 * - 'expired': consent has passed its validity period and must be renewed
 */
export type ConsentStatus = 'pending' | 'granted' | 'withdrawn' | 'expired';

/**
 * Purpose categories for data collection under DPDP Act.
 * Each purpose must be explicitly consented to by the data principal.
 */
export type DataPurpose =
  /** Core educational service delivery -- teaching, assessments, progress tracking */
  | 'educational_service'
  /** Government regulatory compliance (UDISE+, OASIS, state portals) */
  | 'regulatory_compliance'
  /** Communication with parents/guardians about student progress */
  | 'parent_communication'
  /** Fee collection and financial record-keeping */
  | 'financial_processing'
  /** Attendance tracking for RTE compliance */
  | 'attendance_tracking'
  /** Board exam registration and result processing */
  | 'exam_processing';

/** Consent record for a data principal */
export interface DpdpConsent {
  /** UUID of the consent record */
  id: string;
  /** The data principal (student user ID or parent user ID) */
  dataPrincipalId: string;
  /** Institute (data fiduciary) that collected consent */
  instituteId: string;
  /** What data is being collected */
  purposes: DataPurpose[];
  /** Current consent status */
  status: ConsentStatus;
  /** When consent was granted */
  grantedAt: Date | null;
  /** When consent was withdrawn (right to withdrawal) */
  withdrawnAt: Date | null;
  /** When consent expires (must be renewed) */
  expiresAt: Date | null;
  /** Whether this is parental consent for a minor (under-18) */
  isParentalConsent: boolean;
  /** Parent/guardian who gave consent on behalf of minor */
  consentGivenBy: string | null;
  /** Version of the consent form (for audit trail) */
  consentFormVersion: string;
}

/** Data erasure request under DPDP Act Right to Erasure */
export interface ErasureRequest {
  /** UUID of the erasure request */
  id: string;
  /** The data principal requesting erasure */
  dataPrincipalId: string;
  /** Institute processing the request */
  instituteId: string;
  /**
   * Status of the erasure request.
   *
   * - 'requested': data principal has submitted the erasure request
   * - 'processing': institute is evaluating and executing the erasure
   * - 'completed': all personal data has been erased or anonymized
   * - 'rejected': erasure denied due to legal retention requirement
   */
  status: 'requested' | 'processing' | 'completed' | 'rejected';
  /** Reason for rejection (if applicable -- e.g., legal retention requirement) */
  rejectionReason: string | null;
  /** When the request was made */
  requestedAt: Date;
  /** When erasure was completed */
  completedAt: Date | null;
}

/** Breach notification record (72-hour DPDP requirement) */
export interface BreachNotification {
  /** UUID of the notification record */
  id: string;
  /** When the breach was detected */
  detectedAt: Date;
  /** When DPB (Data Protection Board) was notified -- must be within 72 hours */
  dpbNotifiedAt: Date | null;
  /** When affected data principals were notified */
  principalsNotifiedAt: Date | null;
  /** Nature of the breach */
  breachDescription: string;
  /** Number of affected data principals */
  affectedCount: number;
  /** Remedial actions taken */
  remedialActions: string;
}
