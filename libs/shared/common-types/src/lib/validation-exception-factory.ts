import type { ValidationError } from '@nestjs/common';
import { BusinessException } from './business-exception';
import { ErrorCode } from './error-codes';

function collectMessages(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => [
    ...Object.values(error.constraints ?? {}),
    ...collectMessages(error.children ?? []),
  ]);
}

/** `ValidationPipe.exceptionFactory` shared by main.ts and the integration harness. */
export function validationExceptionFactory(errors: ValidationError[]): BusinessException {
  return new BusinessException(ErrorCode.VALIDATION_FAILED, collectMessages(errors).join('; '));
}
