import { BusinessException, ErrorCode } from '@roviq/common-types';

export function qualificationNotFound(id: string): BusinessException {
  return new BusinessException(
    ErrorCode.STAFF_QUALIFICATION_NOT_FOUND,
    `Staff qualification ${id} not found`,
  );
}
