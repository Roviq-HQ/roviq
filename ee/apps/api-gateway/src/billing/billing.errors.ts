import { BusinessException, ErrorCode } from '@roviq/common-types';

/** Error codes thrown by the billing services. All live in the shared `ErrorCode` registry. */
export type BillingErrorCode = Extract<
  ErrorCode,
  | 'BAD_REQUEST'
  | 'PLAN_NOT_FOUND'
  | 'SUBSCRIPTION_NOT_FOUND'
  | 'INVOICE_NOT_FOUND'
  | 'PAYMENT_NOT_FOUND'
  | 'GATEWAY_CONFIG_NOT_FOUND'
  | 'INSTITUTE_NOT_FOUND'
  | 'PLAN_IN_USE'
  | 'PLAN_CODE_DUPLICATE'
  | 'SUBSCRIPTION_ALREADY_ACTIVE'
  | 'SUBSCRIPTION_TERMINAL'
  | 'INVOICE_ALREADY_PAID'
  | 'INVOICE_NOT_PAYABLE'
  | 'INVOICE_PERIOD_ALREADY_BILLED'
  | 'PAYMENT_VERIFICATION_FAILED'
  | 'PAYMENT_GATEWAY_NOT_CONFIGURED'
  | 'GATEWAY_ERROR'
  | 'REFUND_EXCEEDS_PAID'
  | 'CONCURRENT_MODIFICATION'
  | 'UTR_INVALID'
  | 'UTR_ALREADY_SUBMITTED'
  | 'PAYER_CONTACT_MISSING'
>;

export function billingError(code: BillingErrorCode, message: string): never {
  throw new BusinessException(ErrorCode[code], message);
}
