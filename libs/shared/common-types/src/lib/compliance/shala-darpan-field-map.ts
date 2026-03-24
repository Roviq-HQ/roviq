/**
 * Rajasthan Shala Darpan field mapping (ROV-140, PRD 15.3).
 *
 * Maps Roviq entities to Shala Darpan portal fields for Rajasthan
 * government's institute management system.
 *
 * STUB: User-level Shala Darpan IDs are stored in Identity Service profiles.
 */

export const SHALA_DARPAN_FIELDS = {
  /** Institute-level Shala Darpan ID -- from institute_identifiers */
  instituteShalaDarpanId: {
    source: 'institute_identifiers',
    filter: { type: 'SHALA_DARPAN_ID' },
    field: 'value',
    /** DPDP Purpose: Government regulatory compliance for Rajasthan-based institutes */
    dpdpPurpose: 'Regulatory compliance -- Rajasthan Education Department mandatory reporting',
  },

  /** Student Shala Darpan IDs (stub -- stored in Identity Service profiles) */
  studentShalaDarpanId: {
    source: 'identity_service',
    field: 'STUB',
    note: 'Stored in student profile metadata',
    /** DPDP Purpose: Student identification for state government education records */
    dpdpPurpose: 'Student identification for state government education records',
  },

  /** Teacher Shala Darpan IDs (stub -- stored in Identity Service profiles) */
  teacherShalaDarpanId: {
    source: 'identity_service',
    field: 'STUB',
    note: 'Stored in teacher profile metadata',
    /** DPDP Purpose: Teacher identification for state government payroll and records */
    dpdpPurpose: 'Teacher identification for state government payroll and records',
  },

  /** Enrollment data (stub -- needs Enrollment Service) */
  enrollment: {
    source: 'enrollment_service',
    field: 'STUB',
    /** DPDP Purpose: Student enrollment tracking for government RTE compliance */
    dpdpPurpose: 'Student enrollment tracking for government RTE compliance',
  },

  /** Attendance data (stub -- needs Attendance Service) */
  attendance: {
    source: 'attendance_service',
    field: 'STUB',
    /** DPDP Purpose: Attendance records for mid-day meal scheme and RTE compliance */
    dpdpPurpose: 'Attendance records for mid-day meal scheme and RTE compliance',
  },
} as const;
