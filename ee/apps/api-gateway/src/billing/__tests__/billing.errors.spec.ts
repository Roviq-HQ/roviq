import assert from 'node:assert';
import { HttpStatus } from '@nestjs/common';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import { describe, expect, it } from 'vitest';
import { billingError } from '../billing.errors';

describe('billingError', () => {
  it('should throw a BusinessException so the specific code reaches the client', () => {
    let thrown: unknown;
    try {
      billingError('PAYMENT_NOT_FOUND', 'No pending payment found for this order');
    } catch (err) {
      thrown = err;
    }

    assert(thrown instanceof BusinessException);
    expect(thrown).toMatchObject({
      code: ErrorCode.PAYMENT_NOT_FOUND,
      message: 'No pending payment found for this order',
    });
    expect(thrown.getStatus()).toBe(HttpStatus.NOT_FOUND);
  });

  it('should keep the status each billing code had before it joined the shared registry', () => {
    const statusOf = (code: Parameters<typeof billingError>[0]) => {
      try {
        billingError(code, code);
      } catch (err) {
        if (err instanceof BusinessException) return err.getStatus();
      }
      return undefined;
    };

    expect(statusOf('PAYMENT_VERIFICATION_FAILED')).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(statusOf('INVOICE_ALREADY_PAID')).toBe(HttpStatus.CONFLICT);
    expect(statusOf('GATEWAY_ERROR')).toBe(HttpStatus.BAD_GATEWAY);
    expect(statusOf('UTR_INVALID')).toBe(HttpStatus.BAD_REQUEST);
  });
});
