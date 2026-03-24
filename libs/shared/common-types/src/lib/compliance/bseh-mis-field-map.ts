/**
 * Haryana BSEH MIS Portal field mapping (ROV-140, PRD 15.3).
 *
 * Maps Roviq entities to the Board of School Education Haryana's
 * Management Information System portal fields.
 *
 * STUB: Student registration numbers and staff statements need
 * Identity and Enrollment services.
 */

export const BSEH_MIS_FIELDS = {
  /** BSEH affiliation number -- from institute_identifiers */
  affiliationNumber: {
    source: 'institute_identifiers',
    filter: { type: 'BSEH_AFFILIATION' },
    field: 'value',
    /** DPDP Purpose: Board affiliation verification for exam registration */
    dpdpPurpose: 'Regulatory compliance -- BSEH board affiliation verification',
  },

  /** Student registration numbers (stub -- needs Identity/Enrollment Service) */
  studentRegistration: {
    source: 'identity_service',
    field: 'STUB',
    note: 'BSEH student registration number stored in student profile',
    /** DPDP Purpose: Board exam registration and result processing */
    dpdpPurpose: 'Board exam registration and result processing',
  },

  /** Staff statements (stub -- needs Identity Service) */
  staffStatement: {
    source: 'identity_service',
    field: 'STUB',
    note: 'Annual staff verification for board compliance',
    /** DPDP Purpose: Faculty verification for board affiliation renewal */
    dpdpPurpose: 'Faculty verification for board affiliation renewal',
  },

  /** Exam center allocation data (stub) */
  examCenter: {
    source: 'institutes',
    field: 'STUB',
    note: 'Exam center allocation based on institute capacity',
    /** DPDP Purpose: Board exam logistics and center assignment */
    dpdpPurpose: 'Board exam logistics and center assignment',
  },
} as const;
