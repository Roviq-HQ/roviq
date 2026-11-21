import { ErrorCode } from '@roviq/common-types';

/** Codes an admission mutation can answer with; anything else gets the generic copy. */
const ADMISSION_ERROR_KEYS = {
  [ErrorCode.INVALID_STATE_TRANSITION]: 'invalidState',
  [ErrorCode.CONCURRENT_MODIFICATION]: 'concurrentModification',
  [ErrorCode.APPLICATION_NOT_FOUND]: 'applicationNotFound',
  [ErrorCode.ENQUIRY_NOT_FOUND]: 'enquiryNotFound',
  [ErrorCode.ENQUIRY_ALREADY_CONVERTED]: 'enquiryAlreadyConverted',
  [ErrorCode.ACADEMIC_YEAR_NOT_FOUND]: 'academicYearNotFound',
  [ErrorCode.ACADEMIC_YEAR_NOT_ACTIVE]: 'academicYearNotActive',
  [ErrorCode.STANDARD_NOT_FOUND]: 'standardNotFound',
  [ErrorCode.SECTION_REQUIRED]: 'sectionRequired',
  [ErrorCode.SECTION_STANDARD_MISMATCH]: 'sectionStandardMismatch',
  [ErrorCode.VALIDATION_FAILED]: 'validation',
  [ErrorCode.FORBIDDEN]: 'forbidden',
} as const;

export type AdmissionErrorKey =
  | (typeof ADMISSION_ERROR_KEYS)[keyof typeof ADMISSION_ERROR_KEYS]
  | 'generic';

export function admissionErrorKey(code: string | null): AdmissionErrorKey {
  const match = Object.entries(ADMISSION_ERROR_KEYS).find(([known]) => known === code);
  return match ? match[1] : 'generic';
}
