import {
  MESSAGE_TEMPLATE_CATEGORY_VALUES,
  type MessageTemplateCategory,
  type MessageTemplateStatus,
} from '@roviq/common-types';
import { ChannelAdapterError } from '../adapters/channel-adapter';
import type { TemplateSubmission } from './template-submission';
import { retryAfterMsOf } from './whatsapp-cloud.client';

const REQUEST_TIMEOUT_MS = 15_000;
const PAGE_LIMIT = 100;
/** The provider pages a long list; more than this many pages means something is wrong. */
const MAX_PAGES = 20;

/** One template as the provider holds it, in one language. */
export interface ProviderTemplate {
  id: string;
  name: string;
  language: string;
  status: MessageTemplateStatus;
  category: MessageTemplateCategory | null;
  rejectedReason: string | null;
  quality: string | null;
  /** The approved body text, to compare with the code's definition. */
  body: string | null;
  buttonLabel: string | null;
}

/** The provider's template statuses, reduced to the ones the system acts on. */
export function templateStatusOf(value: unknown): MessageTemplateStatus {
  switch (typeof value === 'string' ? value.toUpperCase() : '') {
    case 'APPROVED':
      return 'APPROVED';
    case 'PENDING':
    case 'IN_APPEAL':
      return 'PENDING';
    case 'REJECTED':
    case 'LIMIT_EXCEEDED':
      return 'REJECTED';
    case 'PAUSED':
      return 'PAUSED';
    default:
      // DISABLED, PENDING_DELETION, DELETED, ARCHIVED and anything new: not sendable.
      return 'DISABLED';
  }
}

export function templateCategoryOf(value: unknown): MessageTemplateCategory | null {
  const upper = typeof value === 'string' ? value.toUpperCase() : '';
  return MESSAGE_TEMPLATE_CATEGORY_VALUES.find((c) => c === upper) ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function componentsOf(value: unknown): { body: string | null; buttonLabel: string | null } {
  if (!Array.isArray(value)) return { body: null, buttonLabel: null };
  let body: string | null = null;
  let buttonLabel: string | null = null;
  for (const c of value) {
    if (!isRecord(c)) continue;
    const type = text(c.type)?.toUpperCase();
    if (type === 'BODY') body = text(c.text);
    if (type === 'BUTTONS' && Array.isArray(c.buttons) && isRecord(c.buttons[0])) {
      buttonLabel = text(c.buttons[0].text);
    }
  }
  return { body, buttonLabel };
}

function providerTemplateOf(row: unknown): ProviderTemplate | null {
  if (!isRecord(row)) return null;
  const id = text(row.id);
  const name = text(row.name);
  const language = text(row.language);
  if (!id || !name || !language) return null;
  const quality = isRecord(row.quality_score) ? text(row.quality_score.score) : null;
  return {
    id,
    name,
    language,
    status: templateStatusOf(row.status),
    category: templateCategoryOf(row.category),
    rejectedReason: text(row.rejected_reason),
    quality,
    ...componentsOf(row.components),
  };
}

/** Permission (10, 200, 190: token), throttling (4, 80008, 130429), an existing name (2388024). */
function errorFor(body: unknown, httpStatus: number, retryAfterMs: number | null) {
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  const code = error && typeof error.code === 'number' ? error.code : null;
  const subcode = error && typeof error.error_subcode === 'number' ? error.error_subcode : null;
  if (code === 10 || code === 200 || code === 190 || (code !== null && code >= 200 && code < 300)) {
    return new ChannelAdapterError('WA_PERMISSION_MISSING', `provider code ${code}`, false);
  }
  if (code === 4 || code === 80008 || code === 130429 || httpStatus === 429) {
    return new ChannelAdapterError('WA_RATE_LIMITED', `provider code ${code}`, true, retryAfterMs);
  }
  if (subcode === 2388023 || subcode === 2388024) {
    return new ChannelAdapterError('WA_TEMPLATE_EXISTS', `provider subcode ${subcode}`, false);
  }
  if (httpStatus >= 500) return new ChannelAdapterError('WA_UNREACHABLE', `http ${httpStatus}`);
  return new ChannelAdapterError(
    'WA_TEMPLATE_INVALID',
    `provider code ${code ?? 'none'}${subcode === null ? '' : `/${subcode}`}, http ${httpStatus}`,
    false,
  );
}

/**
 * The provider's template endpoints of one account (ROV-333): list what it holds and submit a
 * new template. Answers map to a `ChannelAdapterError` with a stable code. Logs nothing.
 */
export class WhatsAppTemplateClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly request: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async list(accountId: string, accessToken: string): Promise<ProviderTemplate[]> {
    const fields = 'id,name,language,status,category,rejected_reason,quality_score,components';
    let next: string | null =
      `${this.baseUrl}/${encodeURIComponent(accountId)}/message_templates?fields=${fields}&limit=${PAGE_LIMIT}`;
    const all: ProviderTemplate[] = [];
    for (let page = 0; next !== null; page += 1) {
      if (page >= MAX_PAGES) throw new ChannelAdapterError('WA_UNREACHABLE', 'too many pages');
      const body = await this.call(next, accessToken, { method: 'GET' });
      const data = isRecord(body) && Array.isArray(body.data) ? body.data : [];
      for (const row of data) {
        const parsed = providerTemplateOf(row);
        if (parsed) all.push(parsed);
      }
      const paging = isRecord(body) && isRecord(body.paging) ? body.paging : null;
      next = paging ? text(paging.next) : null;
    }
    return all;
  }

  async create(
    accountId: string,
    accessToken: string,
    submission: TemplateSubmission,
  ): Promise<{
    id: string;
    status: MessageTemplateStatus;
    category: MessageTemplateCategory | null;
  }> {
    const body = await this.call(
      `${this.baseUrl}/${encodeURIComponent(accountId)}/message_templates`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          name: submission.name,
          language: submission.language,
          category: submission.category,
          components: [
            {
              type: 'BODY',
              text: submission.body,
              ...(submission.bodyExamples.length > 0
                ? { example: { body_text: [submission.bodyExamples] } }
                : {}),
            },
            {
              type: 'BUTTONS',
              buttons: [
                {
                  type: 'URL',
                  text: submission.buttonLabel,
                  url: submission.buttonUrl,
                  example: [submission.buttonExample],
                },
              ],
            },
          ],
        }),
      },
    );
    const id = isRecord(body) ? text(body.id) : null;
    if (!id) throw new ChannelAdapterError('WA_TEMPLATE_INVALID', 'no template id in the answer');
    return {
      id,
      status: templateStatusOf(isRecord(body) ? body.status : null),
      category: templateCategoryOf(isRecord(body) ? body.category : null),
    };
  }

  private async call(url: string, accessToken: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.request(url, {
        ...init,
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // The cause can hold the request, and the request holds the token.
      throw new ChannelAdapterError('WA_UNREACHABLE', 'request failed or timed out');
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw errorFor(body, response.status, retryAfterMsOf(response.headers.get('retry-after')));
    }
    return body;
  }
}
