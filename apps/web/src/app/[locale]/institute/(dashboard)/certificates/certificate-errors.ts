import { ErrorCode } from '@roviq/common-types';
import { extractGraphQLErrorCode } from '@roviq/graphql';

/** Error codes the certificate mutations raise that the user can act on. */
const CERTIFICATE_ERROR_KEYS = {
  [ErrorCode.CERTIFICATE_TEMPLATE_NOT_FOUND]: 'templateNotFound',
  [ErrorCode.CERTIFICATE_NOT_FOUND]: 'certificateNotFound',
  [ErrorCode.STUDENT_NOT_FOUND]: 'studentNotFound',
  [ErrorCode.INVALID_STATE_TRANSITION]: 'invalidState',
  [ErrorCode.VALIDATION_FAILED]: 'invalidInput',
  [ErrorCode.FORBIDDEN]: 'forbidden',
} as const;

type CertificateErrorKey = (typeof CERTIFICATE_ERROR_KEYS)[keyof typeof CERTIFICATE_ERROR_KEYS];

/** Translated description for a failed certificate request, by error code; never the server text. */
export function certificateErrorCopy(
  t: (key: `other.errors.${CertificateErrorKey | 'generic'}`) => string,
  err: unknown,
): string {
  const code = extractGraphQLErrorCode(err);
  const key = Object.entries(CERTIFICATE_ERROR_KEYS).find(([known]) => known === code)?.[1];
  return t(`other.errors.${key ?? 'generic'}`);
}
