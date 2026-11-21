import { ErrorCode } from '@roviq/common-types';

/** Codes a TC action can answer with; anything else gets the generic copy. */
const TC_ERROR_KEYS = {
  [ErrorCode.TC_ALREADY_REQUESTED]: 'alreadyRequested',
  [ErrorCode.INVALID_STATE_TRANSITION]: 'invalidState',
  [ErrorCode.TC_NOT_FOUND]: 'notFound',
  [ErrorCode.STUDENT_NOT_ENROLLED]: 'studentNotEnrolled',
  [ErrorCode.STUDENT_NOT_FOUND]: 'studentNotFound',
  [ErrorCode.VALIDATION_FAILED]: 'validation',
  [ErrorCode.FORBIDDEN]: 'forbidden',
} as const;

export type TcErrorKey = (typeof TC_ERROR_KEYS)[keyof typeof TC_ERROR_KEYS] | 'generic';

export function tcErrorKey(code: string | null): TcErrorKey {
  const match = Object.entries(TC_ERROR_KEYS).find(([known]) => known === code);
  return match ? match[1] : 'generic';
}
