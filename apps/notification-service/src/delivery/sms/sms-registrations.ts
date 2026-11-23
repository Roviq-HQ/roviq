/**
 * Registration ids of the SMS templates, from `SMS_TEMPLATE_IDS`: a JSON object
 * `{ "<TEMPLATE_KEY>:<locale>": "<registration id>" }`, read once at start.
 */
export class SmsRegistrations {
  private readonly ids: ReadonlyMap<string, string>;

  /** Throws when the value is not a JSON object of non-empty strings; the error never quotes it. */
  constructor(raw: string) {
    this.ids = new Map(Object.entries(parse(raw)));
  }

  idFor(registrationKey: string): string | null {
    return this.ids.get(registrationKey) ?? null;
  }
}

export const SMS_TEMPLATE_IDS_ERROR =
  'SMS_TEMPLATE_IDS — must be a JSON object mapping "<TEMPLATE_KEY>:<locale>" to a non-empty registration id';

function parse(raw: string): Record<string, string> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    // The parser's message quotes the input.
    throw new Error(SMS_TEMPLATE_IDS_ERROR);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(SMS_TEMPLATE_IDS_ERROR);
  }
  const out: Record<string, string> = {};
  for (const [key, id] of Object.entries(value)) {
    if (key.trim() === '' || typeof id !== 'string' || id.trim() === '') {
      throw new Error(SMS_TEMPLATE_IDS_ERROR);
    }
    out[key] = id.trim();
  }
  return out;
}
