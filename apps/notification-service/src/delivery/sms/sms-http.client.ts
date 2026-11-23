import { ChannelAdapterError } from '../adapters/channel-adapter';
import type { SmsSend } from './sms-template';

export const SMS_HTTP_PROVIDER = 'sms_http';

const REQUEST_TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The provider's error texts are not documented reliably, so they are matched loosely, in order.
const SENDER_BLOCKED = /auth\s*key|authenticat|not\s+whitelisted|blacklist|balance|account/i;
const RATE_LIMITED = /too\s+many|\brate\b|\blimit/i;
const TEMPLATE_REJECTED = /template|flow|dlt|sender\s*id/i;
const INVALID_NUMBER = /\bmobile\b|\bnumbers?\b/i;

/**
 * The stable error for an answer that is not a usable success. Only the HTTP status and a
 * numeric provider code go into the message: the provider's text may quote the phone number.
 */
export function smsErrorFor(httpStatus: number, body: unknown): ChannelAdapterError {
  const providerCode = isRecord(body) && typeof body.code === 'number' ? body.code : null;
  const detail = `http ${httpStatus}${providerCode === null ? '' : `, provider code ${providerCode}`}`;
  const text =
    isRecord(body) && body.type !== 'success' && typeof body.message === 'string'
      ? body.message
      : '';
  const says = (pattern: RegExp) => text !== '' && pattern.test(text);

  if (httpStatus === 401 || httpStatus === 403 || says(SENDER_BLOCKED)) {
    return new ChannelAdapterError('SMS_SENDER_BLOCKED', detail, false);
  }
  if (httpStatus === 429 || says(RATE_LIMITED)) {
    return new ChannelAdapterError('SMS_RATE_LIMITED', detail, true);
  }
  if (says(TEMPLATE_REJECTED))
    return new ChannelAdapterError('SMS_TEMPLATE_REJECTED', detail, false);
  if (says(INVALID_NUMBER)) return new ChannelAdapterError('SMS_INVALID_NUMBER', detail, false);
  if (httpStatus >= 500) return new ChannelAdapterError('SMS_UNREACHABLE', detail, true);
  return new ChannelAdapterError('SMS_REJECTED', detail, false);
}

function requestIdOf(body: unknown): string | null {
  if (!isRecord(body) || body.type !== 'success') return null;
  return typeof body.message === 'string' && body.message.length > 0 ? body.message : null;
}

/** The API takes a number as digits with country code, without the plus sign. */
const digits = (phone: string) => phone.replace(/\D/g, '');

/**
 * The provider's send endpoint for registered templates: one recipient per request, a timeout,
 * and an answer mapped to a request id or a `ChannelAdapterError` with a stable code. Logs
 * nothing: the variables can hold a one-time code.
 */
export class SmsHttpClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly authKey: string,
    private readonly senderId: string | null = null,
    private readonly request: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /** Resolves to the provider's request id. */
  async send(to: string, sms: SmsSend): Promise<string> {
    const recipient: Record<string, string> = { mobiles: digits(to) };
    sms.variables.forEach((value, index) => {
      recipient[`var${index + 1}`] = value;
    });
    const payload = {
      template_id: sms.templateId,
      short_url: '0',
      recipients: [recipient],
      ...(this.senderId ? { sender: this.senderId } : {}),
      ...(sms.unicode ? { unicode: 1 } : {}),
    };

    let response: Response;
    try {
      response = await this.request(`${this.baseUrl}/flow`, {
        method: 'POST',
        headers: { authkey: this.authKey, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // The cause can hold the request, and the request holds the key and the code.
      throw new ChannelAdapterError('SMS_UNREACHABLE', 'request failed or timed out', true);
    }
    const body: unknown = await response.json().catch(() => null);
    const requestId = response.ok ? requestIdOf(body) : null;
    if (requestId === null) throw smsErrorFor(response.status, body);
    return requestId;
  }
}
