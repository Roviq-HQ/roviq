import type { ValidationError } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { BusinessException } from '../lib/business-exception';
import { validationExceptionFactory } from '../lib/validation-exception-factory';

describe('validationExceptionFactory', () => {
  it('should build a VALIDATION_FAILED exception from the validator messages', () => {
    const errors: ValidationError[] = [
      { property: 'username', constraints: { isNotEmpty: 'username should not be empty' } },
      { property: 'password', constraints: { minLength: 'password is too short' } },
    ];

    const exception = validationExceptionFactory(errors);

    expect(exception).toBeInstanceOf(BusinessException);
    expect(exception.code).toBe('VALIDATION_FAILED');
    expect(exception.getStatus()).toBe(400);
    expect(exception.message).toBe('username should not be empty; password is too short');
  });

  it('should include messages from nested objects', () => {
    const errors: ValidationError[] = [
      {
        property: 'address',
        children: [{ property: 'pincode', constraints: { matches: 'pincode must be 6 digits' } }],
      },
    ];

    expect(validationExceptionFactory(errors).message).toBe('pincode must be 6 digits');
  });
});
