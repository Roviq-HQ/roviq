import { HttpException } from '@nestjs/common';
import { ERROR_STATUS, type ErrorCode } from './error-codes';

/**
 * Typed business exception for institute-service mutations.
 *
 * Produces a consistent JSON response:
 * ```json
 * { "statusCode": 409, "error": "INSTITUTE_CODE_DUPLICATE", "message": "..." }
 * ```
 *
 * The `message` is i18n-translated at the controller/resolver layer.
 * The `error` code is machine-readable and language-independent.
 */
export class BusinessException extends HttpException {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    const status = ERROR_STATUS[code];
    super({ statusCode: status, error: code, message }, status);
    this.code = code;
  }
}
