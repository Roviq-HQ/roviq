import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { ErrorCode } from '@roviq/common-types';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messagesEn from '../../../../../../../messages/en/certificates.json';
import { certificateErrorCopy } from '../certificate-errors';

const t = createTranslator({
  locale: 'en',
  messages: { certificates: messagesEn },
  namespace: 'certificates',
});
const copy = messagesEn.other.errors;

function failure(code: string) {
  return new CombinedGraphQLErrors({
    errors: [{ message: 'raw server text', extensions: { code } }],
  });
}

describe('certificateErrorCopy', () => {
  it.each([
    [ErrorCode.CERTIFICATE_TEMPLATE_NOT_FOUND, copy.templateNotFound],
    [ErrorCode.CERTIFICATE_NOT_FOUND, copy.certificateNotFound],
    [ErrorCode.STUDENT_NOT_FOUND, copy.studentNotFound],
    [ErrorCode.INVALID_STATE_TRANSITION, copy.invalidState],
    [ErrorCode.VALIDATION_FAILED, copy.invalidInput],
    [ErrorCode.FORBIDDEN, copy.forbidden],
  ])('should give translated copy for %s', (code, expected) => {
    expect(certificateErrorCopy(t, failure(code))).toBe(expected);
  });

  it('should fall back to generic copy, never the server message', () => {
    expect(certificateErrorCopy(t, failure('INTERNAL_ERROR'))).toBe(copy.generic);
    expect(certificateErrorCopy(t, new Error('raw server text'))).toBe(copy.generic);
  });
});
