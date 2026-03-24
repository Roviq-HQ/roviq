/**
 * UDISE+ Data Capture Format field mapping (ROV-140, PRD 15.1).
 *
 * Maps Roviq entity fields to UDISE+ DCF field codes for annual report generation.
 * UDISE+ is India's Unified District Information System for Education Plus.
 *
 * STUB: Actual report generation will be implemented when Enrollment and Identity
 * services provide the required data.
 */

/** UDISE+ school profile field mapping */
export const UDISE_SCHOOL_PROFILE = {
  /** 11-digit UDISE+ code -- from institute_identifiers.type = 'UDISE_PLUS' */
  udiseCode: {
    source: 'institute_identifiers',
    filter: { type: 'UDISE_PLUS' },
    field: 'value',
  },
  /** Institute name -- from institutes.name (en key) */
  schoolName: { source: 'institutes', field: 'name' },
  /** District -- from institutes.address.district (essential for UDISE+ grouping) */
  district: { source: 'institutes', field: 'address.district' },
  /** State -- from institutes.address.state */
  state: { source: 'institutes', field: 'address.state' },
  /** PIN code -- from institutes.address.postalCode */
  pinCode: { source: 'institutes', field: 'address.postalCode' },
  /** GPS latitude -- from institutes.address.coordinates (OASIS compliance) */
  latitude: { source: 'institutes', field: 'address.coordinates.lat' },
  /** GPS longitude -- from institutes.address.coordinates (OASIS compliance) */
  longitude: { source: 'institutes', field: 'address.coordinates.lng' },
  /** Management type -- derived from institute ownership structure */
  managementType: {
    source: 'institutes',
    field: 'type',
    note: 'Mapped from InstituteType',
  },
} as const;

/** UDISE+ section-wise enrollment mapping (stub -- needs Enrollment Service) */
export const UDISE_ENROLLMENT = {
  /** Class/grade -- from standards.udise_class_code (-3 to 12) */
  classCode: { source: 'standards', field: 'udiseClassCode' },
  /** Section name -- from sections.name */
  sectionName: { source: 'sections', field: 'name' },
  /** Total enrollment -- from sections.current_strength (denormalized count) */
  totalEnrollment: { source: 'sections', field: 'currentStrength' },
  /** Boys in General category (stub -- needs Enrollment Service) */
  boysGeneral: {
    source: 'enrollment_service',
    field: 'STUB',
    note: 'Needs Enrollment Service',
  },
  /** Girls in General category (stub -- needs Enrollment Service) */
  girlsGeneral: {
    source: 'enrollment_service',
    field: 'STUB',
    note: 'Needs Enrollment Service',
  },
  /** Boys in Scheduled Caste category (stub -- needs Enrollment Service) */
  boysSC: {
    source: 'enrollment_service',
    field: 'STUB',
    note: 'Needs Enrollment Service',
  },
  /** Girls in Scheduled Caste category (stub -- needs Enrollment Service) */
  girlsSC: {
    source: 'enrollment_service',
    field: 'STUB',
    note: 'Needs Enrollment Service',
  },
  /** Boys in Other Backward Classes category (stub -- needs Enrollment Service) */
  boysOBC: {
    source: 'enrollment_service',
    field: 'STUB',
    note: 'Needs Enrollment Service',
  },
  /** Girls in Other Backward Classes category (stub -- needs Enrollment Service) */
  girlsOBC: {
    source: 'enrollment_service',
    field: 'STUB',
    note: 'Needs Enrollment Service',
  },
} as const;

/** UDISE+ teacher mapping (stub -- needs Identity Service) */
export const UDISE_TEACHERS = {
  /** Total teacher count (stub -- needs Identity Service) */
  totalTeachers: {
    source: 'identity_service',
    field: 'STUB',
    note: 'Needs Identity Service',
  },
  /** Male teacher count (stub -- needs Identity Service) */
  maleTeachers: {
    source: 'identity_service',
    field: 'STUB',
    note: 'Needs Identity Service',
  },
  /** Female teacher count (stub -- needs Identity Service) */
  femaleTeachers: {
    source: 'identity_service',
    field: 'STUB',
    note: 'Needs Identity Service',
  },
} as const;
