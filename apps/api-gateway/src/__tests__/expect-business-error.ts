import assert from 'node:assert';
import { BusinessException, type ErrorCode } from '@roviq/common-types';
import { expect } from 'vitest';

/** Asserts `action` fails with a `BusinessException` carrying `code`; returns it for further checks. */
export async function expectBusinessError(
  action: Promise<unknown> | (() => unknown),
  code: ErrorCode,
): Promise<BusinessException> {
  let failure: unknown;
  try {
    await (typeof action === 'function' ? action() : action);
  } catch (error) {
    failure = error;
  }
  assert(
    failure instanceof BusinessException,
    `expected a BusinessException, got ${String(failure)}`,
  );
  expect(failure.code).toBe(code);
  return failure;
}
