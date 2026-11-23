import { z } from 'zod';

/** One recipient's delivery state from a provider's report. */
export interface SmsReport {
  /** The id the provider answered the send with. */
  requestId: string;
  status: 'DELIVERED' | 'FAILED';
  errorCode: string | null;
}

/** The provider's status numbers. Any other number is not final and is dropped. */
const STATUS: Readonly<Record<string, Pick<SmsReport, 'status' | 'errorCode'>>> = {
  '1': { status: 'DELIVERED', errorCode: null },
  '2': { status: 'FAILED', errorCode: 'SMS_UNDELIVERED' },
  '9': { status: 'FAILED', errorCode: 'SMS_BLOCKED_BY_RECIPIENT' },
  '16': { status: 'FAILED', errorCode: 'SMS_REJECTED' },
};

const itemSchema = z.looseObject({
  requestId: z.string().min(1),
  report: z.array(z.looseObject({ status: z.union([z.string(), z.number()]) })),
});

function fromJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Reduces a report body to what is acted on. The provider posts either a JSON array or a
 * form field `data` holding one; anything else, and anything not understood, gives nothing.
 * Phone numbers and description texts in the body are not read.
 */
export function parseSmsReports(body: unknown): SmsReport[] {
  let items: unknown = body;
  if (typeof body === 'object' && body !== null && !Array.isArray(body) && 'data' in body) {
    items = typeof body.data === 'string' ? fromJson(body.data) : body.data;
  }
  if (!Array.isArray(items)) return [];
  const reports: SmsReport[] = [];
  for (const raw of items) {
    const item = itemSchema.safeParse(raw);
    if (!item.success) continue;
    for (const entry of item.data.report) {
      const known = STATUS[String(entry.status)];
      if (known) reports.push({ requestId: item.data.requestId, ...known });
    }
  }
  return reports;
}
