/**
 * CBSE OASIS 7.0 field mapping (ROV-140, PRD 15.2).
 *
 * Maps Roviq entities to the 13 data sections collected by CBSE's
 * Online Affiliated Schools Information System.
 *
 * STUB: Faculty categorization and student enrollment need Identity
 * and Enrollment services respectively.
 */

/** OASIS 13-section data mapping */
export const OASIS_SECTIONS = {
  /** Section 1: School Profile -- basic institute information for CBSE records */
  schoolProfile: {
    /** Institute name from institutes table */
    schoolName: { source: 'institutes', field: 'name' },
    /** CBSE affiliation number from institute_identifiers */
    affiliationNumber: {
      source: 'institute_identifiers',
      filter: { type: 'CBSE_AFFILIATION' },
      field: 'value',
    },
    /** CBSE school code from institute_identifiers */
    schoolCode: {
      source: 'institute_identifiers',
      filter: { type: 'CBSE_SCHOOL_CODE' },
      field: 'value',
    },
    /** UDISE+ code from institute_identifiers */
    udiseCode: {
      source: 'institute_identifiers',
      filter: { type: 'UDISE_PLUS' },
      field: 'value',
    },
    /** Institute address */
    address: { source: 'institutes', field: 'address' },
    /** Institute contact details */
    contact: { source: 'institutes', field: 'contact' },
  },

  /** Section 2: Faculty Details (stub -- needs Identity Service with PGT/TGT/PRT categorization) */
  facultyDetails: {
    /** Post Graduate Teachers count (stub) */
    pgtCount: {
      source: 'identity_service',
      field: 'STUB',
      note: 'Post Graduate Teachers',
    },
    /** Trained Graduate Teachers count (stub) */
    tgtCount: {
      source: 'identity_service',
      field: 'STUB',
      note: 'Trained Graduate Teachers',
    },
    /** Primary Teachers count (stub) */
    prtCount: {
      source: 'identity_service',
      field: 'STUB',
      note: 'Primary Teachers',
    },
  },

  /** Section 3: Academic Details -- subjects and streams offered */
  academicDetails: {
    /** CBSE subject codes from subjects.board_code (e.g., 041=Math, 042=Physics) */
    subjectsOffered: {
      source: 'subjects',
      field: 'boardCode',
      note: 'Filter by board=CBSE',
    },
    /** Stream-wise section count for senior secondary (Class 11-12) */
    streamSections: {
      source: 'sections',
      field: 'stream',
      note: 'Class 11-12 sections',
    },
  },

  /** Section 4: Student Enrollment (stub -- needs Enrollment Service) */
  studentEnrollment: {
    /** Class-wise enrollment broken down by gender (stub) */
    classWiseEnrollment: {
      source: 'enrollment_service',
      field: 'STUB',
      note: 'Per-class by gender',
    },
  },

  /** Section 5: UDISE Information -- cross-reference with national database */
  udiseInfo: {
    /** UDISE+ code for cross-referencing with national education database */
    udiseCode: {
      source: 'institute_identifiers',
      filter: { type: 'UDISE_PLUS' },
      field: 'value',
    },
  },

  /** Sections 6-13: Infrastructure, Facilities, etc. -- out of scope for v1 */
} as const;
