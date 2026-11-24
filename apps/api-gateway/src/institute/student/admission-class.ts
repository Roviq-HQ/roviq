import { BusinessException, ErrorCode } from '@roviq/common-types';
import type { AdmissionClassResult } from './repositories/types';

/** Turns a failed year, class and section lookup into its not-found error. */
export function assertAdmissionClass(result: AdmissionClassResult): void {
  if (result.kind === 'year_not_found') {
    throw new BusinessException(ErrorCode.ACADEMIC_YEAR_NOT_FOUND, 'Academic year not found');
  }
  if (result.kind === 'standard_not_found') {
    throw new BusinessException(
      ErrorCode.STANDARD_NOT_FOUND,
      'Standard not found in this academic year',
    );
  }
  if (result.kind === 'section_not_found') {
    throw new BusinessException(ErrorCode.SECTION_NOT_FOUND, 'Section not found');
  }
}
