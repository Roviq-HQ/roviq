/**
 * What a failed send means for failover. `provider_unavailable`: this provider cannot send now
 * (unreachable, rate limited after its own retries, sender or account blocked), so another
 * provider of the channel may take the same attempt. `message_refused`: the message or the
 * recipient is the problem, so another provider would refuse it too, or send it twice.
 */
export type FailureKind = 'provider_unavailable' | 'message_refused';

/** The SMTP transport's own error codes. Stored alone or with the SMTP reply: `EAUTH_535`. */
export const SMTP_ERROR_KINDS = {
  ECONNECTION: 'provider_unavailable',
  ETIMEDOUT: 'provider_unavailable',
  ESOCKET: 'provider_unavailable',
  EDNS: 'provider_unavailable',
  ETLS: 'provider_unavailable',
  EREQUIRETLS: 'provider_unavailable',
  EPROTOCOL: 'provider_unavailable',
  EABORT: 'provider_unavailable',
  EAUTH: 'provider_unavailable',
  ENOAUTH: 'provider_unavailable',
  EOAUTH2: 'provider_unavailable',
  EMAXLIMIT: 'provider_unavailable',
  ECONFIG: 'provider_unavailable',
  EPROXY: 'provider_unavailable',
  EENVELOPE: 'message_refused',
  EMESSAGE: 'message_refused',
  ESTREAM: 'message_refused',
  // A failure the transport did not code: not known to be the provider's, so no second send.
  SMTP_ERROR: 'message_refused',
} as const satisfies Record<string, FailureKind>;

/** FCM's own error codes, then the request statuses it answers without one. */
export const FCM_ERROR_KINDS = {
  UNSPECIFIED_ERROR: 'message_refused',
  INVALID_ARGUMENT: 'message_refused',
  UNREGISTERED: 'message_refused',
  SENDER_ID_MISMATCH: 'message_refused',
  NOT_FOUND: 'message_refused',
  QUOTA_EXCEEDED: 'provider_unavailable',
  UNAVAILABLE: 'provider_unavailable',
  INTERNAL: 'provider_unavailable',
  THIRD_PARTY_AUTH_ERROR: 'provider_unavailable',
  UNAUTHENTICATED: 'provider_unavailable',
  PERMISSION_DENIED: 'provider_unavailable',
  RESOURCE_EXHAUSTED: 'provider_unavailable',
  DEADLINE_EXCEEDED: 'provider_unavailable',
} as const satisfies Record<string, FailureKind>;

/** Every code a channel adapter fails with. A new code must be added here to compile. */
export const ADAPTER_ERROR_KINDS = {
  NO_RECIPIENT: 'message_refused',

  ...SMTP_ERROR_KINDS,

  ...FCM_ERROR_KINDS,
  FCM_AUTH: 'provider_unavailable',
  FCM_UNREACHABLE: 'provider_unavailable',
  FCM_BAD_RESPONSE: 'provider_unavailable',
  FCM_SERVER_ERROR: 'provider_unavailable',
  FCM_REJECTED: 'message_refused',

  SMS_SENDER_BLOCKED: 'provider_unavailable',
  SMS_RATE_LIMITED: 'provider_unavailable',
  SMS_UNREACHABLE: 'provider_unavailable',
  SMS_TEMPLATE_REJECTED: 'message_refused',
  SMS_INVALID_NUMBER: 'message_refused',
  SMS_REJECTED: 'message_refused',
  SMS_VARIABLE_TOO_LONG: 'message_refused',
  // Only in a delivery report, after the provider took the message: never failed over.
  SMS_UNDELIVERED: 'message_refused',
  SMS_BLOCKED_BY_RECIPIENT: 'message_refused',

  WA_SENDER_BLOCKED: 'provider_unavailable',
  WA_RATE_LIMITED: 'provider_unavailable',
  WA_UNREACHABLE: 'provider_unavailable',
  WA_TEMPLATE_REJECTED: 'message_refused',
  WA_NOT_ON_WHATSAPP: 'message_refused',
  WA_REJECTED: 'message_refused',
} as const satisfies Record<string, FailureKind>;

export type SmtpErrorCode = keyof typeof SMTP_ERROR_KINDS;
export type FcmErrorCode = keyof typeof FCM_ERROR_KINDS;
type TableCode = keyof typeof ADAPTER_ERROR_KINDS;
export type AdapterErrorCode = TableCode | `${SmtpErrorCode}_${number}`;

export function isTableCode(code: string): code is TableCode {
  return Object.hasOwn(ADAPTER_ERROR_KINDS, code);
}

export function failureKindOf(code: AdapterErrorCode): FailureKind {
  if (isTableCode(code)) return ADAPTER_ERROR_KINDS[code];
  // `EAUTH_535`: the transport's code decides, the SMTP reply is detail.
  const base = code.slice(0, code.lastIndexOf('_'));
  return isTableCode(base) ? ADAPTER_ERROR_KINDS[base] : 'message_refused';
}
