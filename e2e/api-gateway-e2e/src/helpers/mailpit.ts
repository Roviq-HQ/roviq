import { z } from 'zod';

/** The e2e stack's Mailpit; the notification service sends every email there. */
const MAILPIT_URL = `http://localhost:${process.env.E2E_MAILPIT_API_PORT ?? '8026'}`;

const searchSchema = z.object({
  messages: z.array(z.object({ ID: z.string(), Subject: z.string() })),
});
const messageSchema = z.object({ Subject: z.string(), Text: z.string() });

export interface MailpitMessage {
  subject: string;
  text: string;
}

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(`${MAILPIT_URL}${path}`);
  if (!res.ok) throw new Error(`Mailpit ${path} answered ${res.status}`);
  return res.json();
}

/** Polls until an email to `address` whose subject contains `subjectPart` arrives. */
export async function waitForEmail(
  address: string,
  subjectPart: string,
  timeoutMs = 20_000,
): Promise<MailpitMessage> {
  const query = encodeURIComponent(`to:"${address}"`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { messages } = searchSchema.parse(await getJson(`/api/v1/search?query=${query}`));
    const hit = messages.find((m) => m.Subject.includes(subjectPart));
    if (hit) {
      const message = messageSchema.parse(await getJson(`/api/v1/message/${hit.ID}`));
      return { subject: message.Subject, text: message.Text };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No email to ${address} with "${subjectPart}" within ${timeoutMs} ms`);
}
