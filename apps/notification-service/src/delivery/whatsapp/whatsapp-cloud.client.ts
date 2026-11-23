import { ChannelAdapterError } from '../adapters/channel-adapter';
import type { TemplateSend } from './whatsapp-template';

export const WHATSAPP_CLOUD_PROVIDER = 'whatsapp_cloud';

const REQUEST_TIMEOUT_MS = 10_000;

/** The number to send from, with its access token in clear. Built per request, never stored. */
export interface CloudSender {
  providerNumberId: string;
  accessToken: string;
}

/** The provider's numeric error codes, grouped by what an operator has to do about them. */
const ERROR_CODES: ReadonlyArray<{ code: string; retryable: boolean; providerCodes: number[] }> = [
  // The template is missing, paused, or its variables do not fit: fix the registry or the approval.
  {
    code: 'WA_TEMPLATE_REJECTED',
    retryable: false,
    providerCodes: [132000, 132001, 132005, 132007, 132012, 132015, 132016],
  },
  { code: 'WA_NOT_ON_WHATSAPP', retryable: false, providerCodes: [131026, 131030] },
  { code: 'WA_RATE_LIMITED', retryable: true, providerCodes: [4, 80007, 130429, 131048, 131056] },
  // The number or the account may not send: token, payment, policy or a lock.
  {
    code: 'WA_SENDER_BLOCKED',
    retryable: false,
    providerCodes: [10, 190, 200, 368, 131031, 131042, 131045, 133010],
  },
];

/** The stable code for a failure the provider reports later, in a delivery report. */
export function errorCodeForProviderCode(providerCode: number | null): string {
  const known = ERROR_CODES.find(
    (e) => providerCode !== null && e.providerCodes.includes(providerCode),
  );
  return known?.code ?? 'WA_REJECTED';
}

function errorFor(providerCode: number | null, httpStatus: number): ChannelAdapterError {
  const known = ERROR_CODES.find(
    (e) => providerCode !== null && e.providerCodes.includes(providerCode),
  );
  if (known) {
    return new ChannelAdapterError(known.code, `provider code ${providerCode}`, known.retryable);
  }
  if (httpStatus === 429) return new ChannelAdapterError('WA_RATE_LIMITED', 'http 429');
  if (httpStatus >= 500) return new ChannelAdapterError('WA_UNREACHABLE', `http ${httpStatus}`);
  // A refusal this table does not know. The message text may quote the recipient, so only the code is kept.
  return new ChannelAdapterError(
    'WA_REJECTED',
    `provider code ${providerCode ?? 'none'}, http ${httpStatus}`,
    false,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function providerCodeOf(body: unknown): number | null {
  if (!isRecord(body) || !isRecord(body.error)) return null;
  return typeof body.error.code === 'number' ? body.error.code : null;
}

function messageIdOf(body: unknown): string | null {
  if (!isRecord(body) || !Array.isArray(body.messages)) return null;
  const [first] = body.messages;
  return isRecord(first) && typeof first.id === 'string' ? first.id : null;
}

/** The API takes a number as digits with country code, without the plus sign. */
const digits = (phone: string) => phone.replace(/\D/g, '');

/**
 * The provider's send endpoint. One request, a timeout, and an answer mapped to a message id
 * or a `ChannelAdapterError` with a stable code. Logs nothing: a body may carry a person's name.
 */
export class WhatsAppCloudClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly request: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  sendTemplate(sender: CloudSender, to: string, template: TemplateSend): Promise<string | null> {
    return this.post(sender, {
      messaging_product: 'whatsapp',
      to: digits(to),
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.languageCode },
        components: [
          {
            type: 'body',
            parameters: template.bodyVariables.map((text) => ({ type: 'text', text })),
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: template.buttonPath }],
          },
        ],
      },
    });
  }

  /** Free text; the provider accepts it only as a reply inside its short reply window. */
  sendText(sender: CloudSender, to: string, body: string): Promise<string | null> {
    return this.post(sender, {
      messaging_product: 'whatsapp',
      to: digits(to),
      type: 'text',
      text: { body, preview_url: false },
    });
  }

  private async post(sender: CloudSender, payload: unknown): Promise<string | null> {
    let response: Response;
    try {
      response = await this.request(
        `${this.baseUrl}/${encodeURIComponent(sender.providerNumberId)}/messages`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${sender.accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch {
      // The cause can hold the request, and the request holds the token.
      throw new ChannelAdapterError('WA_UNREACHABLE', 'request failed or timed out');
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw errorFor(providerCodeOf(body), response.status);
    return messageIdOf(body);
  }
}
