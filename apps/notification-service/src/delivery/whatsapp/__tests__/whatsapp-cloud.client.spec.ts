import { describe, expect, it, type Mock, vi } from 'vitest';
import { ChannelAdapterError } from '../../adapters/channel-adapter';
import {
  type CloudSender,
  errorCodeForProviderCode,
  WhatsAppCloudClient,
} from '../whatsapp-cloud.client';
import type { TemplateSend } from '../whatsapp-template';

const TOKEN = 'fake-access-token-XYZ';
const PHONE = '+919000000001';
const SENDER: CloudSender = { providerNumberId: 'fake/number 1', accessToken: TOKEN };
const TEMPLATE: TemplateSend = {
  name: 'fee_reminder_v1',
  languageCode: 'hi',
  category: 'UTILITY',
  bodyVariables: ['Aarav Sharma', '₹5,000', '20 April 2026'],
  buttonPath: 'institute/fees',
};

const ERROR_TABLE: ReadonlyArray<[number, string, boolean]> = [
  ...[132000, 132001, 132005, 132007, 132012, 132015, 132016].map(
    (c): [number, string, boolean] => [c, 'WA_TEMPLATE_REJECTED', false],
  ),
  ...[131026, 131030].map((c): [number, string, boolean] => [c, 'WA_NOT_ON_WHATSAPP', false]),
  ...[4, 80007, 130429, 131048, 131056].map((c): [number, string, boolean] => [
    c,
    'WA_RATE_LIMITED',
    true,
  ]),
  ...[10, 190, 200, 368, 131031, 131042, 131045, 133010].map((c): [number, string, boolean] => [
    c,
    'WA_SENDER_BLOCKED',
    false,
  ]),
];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function clientAnswering(response: Response | (() => Promise<Response>)) {
  const request = vi.fn<typeof fetch>(
    typeof response === 'function' ? response : () => Promise.resolve(response),
  );
  return {
    request,
    client: new WhatsAppCloudClient('https://graph.example.test/v99.0//', request),
  };
}

async function failureOf(promise: Promise<unknown>): Promise<ChannelAdapterError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ChannelAdapterError);
  if (!(error instanceof ChannelAdapterError)) throw new Error('expected a ChannelAdapterError');
  return error;
}

function expectNoSecrets(error: ChannelAdapterError) {
  for (const text of [error.message, String(error), String(error.cause ?? ''), error.code]) {
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(PHONE);
    expect(text).not.toContain('919000000001');
  }
  expect(error.cause).toBeUndefined();
}

function sentRequest(request: Mock<typeof fetch>) {
  const [call] = request.mock.calls;
  if (!call) throw new Error('no request was sent');
  const [url, init] = call;
  if (typeof init?.body !== 'string') throw new Error('body is not a string');
  return { url, init, body: JSON.parse(init.body) };
}

describe('WhatsAppCloudClient', () => {
  describe('sendTemplate', () => {
    it('should post the template to the number id path with a bearer token', async () => {
      const { request, client } = clientAnswering(
        jsonResponse(200, { messages: [{ id: 'wamid.fake-1' }] }),
      );

      await client.sendTemplate(SENDER, PHONE, TEMPLATE);

      const { url, init } = sentRequest(request);
      expect(url).toBe('https://graph.example.test/v99.0/fake%2Fnumber%201/messages');
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
      });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('should send the body exactly as the provider expects', async () => {
      const { request, client } = clientAnswering(
        jsonResponse(200, { messages: [{ id: 'wamid.fake-1' }] }),
      );

      await client.sendTemplate(SENDER, PHONE, TEMPLATE);

      expect(sentRequest(request).body).toEqual({
        messaging_product: 'whatsapp',
        to: '919000000001',
        type: 'template',
        template: {
          name: 'fee_reminder_v1',
          language: { code: 'hi' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: 'Aarav Sharma' },
                { type: 'text', text: '₹5,000' },
                { type: 'text', text: '20 April 2026' },
              ],
            },
            {
              type: 'button',
              sub_type: 'url',
              index: '0',
              parameters: [{ type: 'text', text: 'institute/fees' }],
            },
          ],
        },
      });
    });

    it('should return the provider message id', async () => {
      const { client } = clientAnswering(
        jsonResponse(200, { messaging_product: 'whatsapp', messages: [{ id: 'wamid.fake-1' }] }),
      );

      await expect(client.sendTemplate(SENDER, PHONE, TEMPLATE)).resolves.toBe('wamid.fake-1');
    });

    it.each([
      ['no messages', {}],
      ['an empty list', { messages: [] }],
      ['an id that is not a string', { messages: [{ id: 5 }] }],
      ['messages that are not a list', { messages: 'wamid.fake-1' }],
    ])('should return null for an answer with %s', async (_case, answer) => {
      const { client } = clientAnswering(jsonResponse(200, answer));

      await expect(client.sendTemplate(SENDER, PHONE, TEMPLATE)).resolves.toBeNull();
    });

    it('should return null for a success answer that is not JSON', async () => {
      const { client } = clientAnswering(new Response('ok', { status: 200 }));

      await expect(client.sendTemplate(SENDER, PHONE, TEMPLATE)).resolves.toBeNull();
    });
  });

  describe('sendText', () => {
    it('should post free text without a link preview', async () => {
      const { request, client } = clientAnswering(
        jsonResponse(200, { messages: [{ id: 'wamid.fake-2' }] }),
      );

      await expect(client.sendText(SENDER, PHONE, 'This number only sends alerts.')).resolves.toBe(
        'wamid.fake-2',
      );

      const { url, body } = sentRequest(request);
      expect(url).toBe('https://graph.example.test/v99.0/fake%2Fnumber%201/messages');
      expect(body).toEqual({
        messaging_product: 'whatsapp',
        to: '919000000001',
        type: 'text',
        text: { body: 'This number only sends alerts.', preview_url: false },
      });
    });
  });

  describe('errors', () => {
    it.each(
      ERROR_TABLE,
    )('should map provider code %i to %s (retryable %s)', async (providerCode, code, retryable) => {
      const { client } = clientAnswering(
        jsonResponse(400, {
          error: {
            code: providerCode,
            message: `Recipient ${PHONE} refused, token ${TOKEN}`,
            fbtrace_id: 'fake-trace',
          },
        }),
      );

      const error = await failureOf(client.sendTemplate(SENDER, PHONE, TEMPLATE));

      expect(error.code).toBe(code);
      expect(error.retryable).toBe(retryable);
      expectNoSecrets(error);
    });

    it('should map an unknown provider code to WA_REJECTED, not retryable', async () => {
      const { client } = clientAnswering(
        jsonResponse(400, { error: { code: 999999, message: `bad number ${PHONE}` } }),
      );

      const error = await failureOf(client.sendTemplate(SENDER, PHONE, TEMPLATE));

      expect(error.code).toBe('WA_REJECTED');
      expect(error.retryable).toBe(false);
      expectNoSecrets(error);
    });

    it('should let a known provider code win over the HTTP status', async () => {
      const { client } = clientAnswering(jsonResponse(500, { error: { code: 131026 } }));

      const error = await failureOf(client.sendTemplate(SENDER, PHONE, TEMPLATE));

      expect(error.code).toBe('WA_NOT_ON_WHATSAPP');
      expect(error.retryable).toBe(false);
    });

    it('should map HTTP 429 without a known code to WA_RATE_LIMITED, retryable', async () => {
      const { client } = clientAnswering(jsonResponse(429, { error: { message: 'slow down' } }));

      const error = await failureOf(client.sendTemplate(SENDER, PHONE, TEMPLATE));

      expect(error.code).toBe('WA_RATE_LIMITED');
      expect(error.retryable).toBe(true);
      expectNoSecrets(error);
    });

    it.each([500, 502, 503])('should map HTTP %i to WA_UNREACHABLE, retryable', async (status) => {
      const { client } = clientAnswering(jsonResponse(status, { error: { message: 'down' } }));

      const error = await failureOf(client.sendTemplate(SENDER, PHONE, TEMPLATE));

      expect(error.code).toBe('WA_UNREACHABLE');
      expect(error.retryable).toBe(true);
      expectNoSecrets(error);
    });

    it.each([
      [
        'a network error',
        () => Promise.reject(new TypeError(`fetch failed for ${TOKEN} ${PHONE}`)),
      ],
      ['an abort', () => Promise.reject(new DOMException(`aborted ${TOKEN}`, 'TimeoutError'))],
    ])('should map %s to WA_UNREACHABLE without its cause', async (_case, answer) => {
      const { client } = clientAnswering(answer);

      const error = await failureOf(client.sendTemplate(SENDER, PHONE, TEMPLATE));

      expect(error.code).toBe('WA_UNREACHABLE');
      expect(error.retryable).toBe(true);
      expectNoSecrets(error);
    });

    it('should throw only a ChannelAdapterError for an error body that is not JSON', async () => {
      const { client } = clientAnswering(
        new Response(`<html>Bad gateway ${TOKEN}</html>`, { status: 400 }),
      );

      const error = await failureOf(client.sendTemplate(SENDER, PHONE, TEMPLATE));

      expect(error.code).toBe('WA_REJECTED');
      expect(error.retryable).toBe(false);
      expectNoSecrets(error);
    });

    it('should map a failed free-text send the same way', async () => {
      const { client } = clientAnswering(jsonResponse(400, { error: { code: 131048 } }));

      const error = await failureOf(client.sendText(SENDER, PHONE, 'hello'));

      expect(error.code).toBe('WA_RATE_LIMITED');
      expect(error.retryable).toBe(true);
    });
  });
});

describe('errorCodeForProviderCode', () => {
  it.each(ERROR_TABLE)('should map provider code %i to %s', (providerCode, code) => {
    expect(errorCodeForProviderCode(providerCode)).toBe(code);
  });

  it.each([
    [null, 'WA_REJECTED'],
    [999999, 'WA_REJECTED'],
    [0, 'WA_REJECTED'],
  ])('should map %s to %s', (providerCode, code) => {
    expect(errorCodeForProviderCode(providerCode)).toBe(code);
  });
});
