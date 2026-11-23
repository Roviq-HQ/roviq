import { z } from 'zod';
import { type InboundIntent, intentOf } from './stop-words';

/** A delivery report for a message this service sent. */
export interface InboundReceipt {
  /** The provider's id of the message the report is about. */
  messageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  recipientPhone: string | null;
  providerUserId: string | null;
  /** The provider's numeric code of a failed delivery. */
  providerErrorCode: number | null;
}

/** A message a person sent to a sender's number. Its text is read once, here, and not kept. */
export interface InboundMessage {
  messageId: string;
  phone: string | null;
  providerUserId: string | null;
  /** A stop request, a request to start again, or anything else. */
  intent: InboundIntent;
}

export interface InboundBatch {
  /** The provider's id of the number the events arrived on; the only key a sender is found by. */
  providerNumberId: string;
  receipts: InboundReceipt[];
  messages: InboundMessage[];
}

const statusSchema = z.looseObject({
  id: z.string().min(1),
  status: z.string(),
  recipient_id: z.string().optional(),
  recipient_user_id: z.string().optional(),
  errors: z.array(z.looseObject({ code: z.number().optional() })).optional(),
});

const messageSchema = z.looseObject({
  id: z.string().min(1),
  from: z.string().optional(),
  from_user_id: z.string().optional(),
  user_id: z.string().optional(),
  type: z.string().optional(),
  text: z.looseObject({ body: z.string().optional() }).optional(),
  button: z.looseObject({ text: z.string().optional() }).optional(),
});

const payloadSchema = z.looseObject({
  entry: z
    .array(
      z.looseObject({
        changes: z
          .array(
            z.looseObject({
              field: z.string().optional(),
              value: z
                .looseObject({
                  metadata: z.looseObject({ phone_number_id: z.string().min(1) }).optional(),
                  contacts: z
                    .array(
                      z.looseObject({
                        wa_id: z.string().optional(),
                        user_id: z.string().optional(),
                      }),
                    )
                    .optional(),
                  statuses: z.array(z.unknown()).optional(),
                  messages: z.array(z.unknown()).optional(),
                })
                .optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

const RECEIPT_STATUSES = ['sent', 'delivered', 'read', 'failed'] as const;
const isReceiptStatus = (s: string): s is InboundReceipt['status'] =>
  (RECEIPT_STATUSES as readonly string[]).includes(s);

/** The provider writes a number as digits with country code; ours carry a plus sign. */
const toPhone = (digits: string | undefined): string | null =>
  digits && /^\d{6,15}$/.test(digits) ? `+${digits}` : null;

function toReceipt(raw: unknown): InboundReceipt | null {
  const status = statusSchema.safeParse(raw);
  if (!status.success || !isReceiptStatus(status.data.status)) return null;
  return {
    messageId: status.data.id,
    status: status.data.status,
    recipientPhone: toPhone(status.data.recipient_id),
    providerUserId: status.data.recipient_user_id ?? null,
    providerErrorCode: status.data.errors?.[0]?.code ?? null,
  };
}

interface Contact {
  wa_id?: string;
  user_id?: string;
}

function toMessage(raw: unknown, contact: Contact | undefined): InboundMessage | null {
  const message = messageSchema.safeParse(raw);
  if (!message.success) return null;
  const text = message.data.text?.body ?? message.data.button?.text ?? '';
  return {
    messageId: message.data.id,
    phone: toPhone(message.data.from) ?? toPhone(contact?.wa_id),
    providerUserId: message.data.from_user_id ?? message.data.user_id ?? contact?.user_id ?? null,
    intent: intentOf(text),
  };
}

const present = <T>(value: T | null): value is T => value !== null;

/**
 * Reduces a webhook body to what is acted on. Anything not understood is dropped, never
 * thrown on: the provider adds fields and event kinds without notice. A tenant id is never
 * read from the body.
 */
export function parseWebhookPayload(body: unknown): InboundBatch[] {
  const payload = payloadSchema.safeParse(body);
  if (!payload.success) return [];
  const batches: InboundBatch[] = [];
  const changes = (payload.data.entry ?? []).flatMap((entry) => entry.changes ?? []);
  for (const { field, value } of changes) {
    if (field !== 'messages' || !value?.metadata) continue;
    const contact = value.contacts?.[0];
    const receipts = (value.statuses ?? []).map(toReceipt).filter(present);
    const messages = (value.messages ?? []).map((raw) => toMessage(raw, contact)).filter(present);
    if (receipts.length > 0 || messages.length > 0) {
      batches.push({ providerNumberId: value.metadata.phone_number_id, receipts, messages });
    }
  }
  return batches;
}
