import { describe, expect, it, type Mock, vi } from 'vitest';
import { ChannelAdapterError } from '../../adapters/channel-adapter';
import { SMS_HTTP_PROVIDER, SmsHttpClient, smsErrorFor } from '../sms-http.client';
import type { SmsSend } from '../sms-template';

const AUTH_KEY = 'fake-auth-key-QWERTY';
const PHONE = '+919000000001';
const CODE = '739155';
const NAME = 'Aarav Sharma';
const SMS: SmsSend = {
  registrationKey: 'AUTH_OTP:en',
  templateId: 'reg-1001',
  variables: [CODE, NAME],
  unicode: false,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function clientAnswering(
  response: Response | (() => Promise<Response>),
  senderId: string | null = null,
) {
  const request = vi.fn<typeof fetch>(
    typeof response === 'function' ? response : () => Promise.resolve(response),
  );
  return {
    request,
    client: new SmsHttpClient('https://sms.example.test/api/v5//', AUTH_KEY, senderId, request),
  };
}

const ok = () => jsonResponse(200, { type: 'success', message: 'req-abc-1' });

function sentRequest(request: Mock<typeof fetch>) {
  const [call] = request.mock.calls;
  if (!call) throw new Error('no request was sent');
  const [url, init] = call;
  if (typeof init?.body !== 'string') throw new Error('body is not a string');
  return { url, init, body: JSON.parse(init.body) };
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
    for (const secret of [AUTH_KEY, PHONE, '919000000001', '9000000001', CODE, NAME]) {
      expect(text).not.toContain(secret);
    }
  }
  expect(error.cause).toBeUndefined();
}

/** A provider text that quotes everything it should not. */
const leaky = (words: string) => `${words} for ${PHONE} key ${AUTH_KEY} var ${CODE} ${NAME}`;

describe('SmsHttpClient', () => {
  it('should name its provider', () => {
    expect(SMS_HTTP_PROVIDER).toBe('sms_http');
  });

  it('should post to the flow path of the base address with the auth key', async () => {
    const { request, client } = clientAnswering(ok());

    await client.send(PHONE, SMS);

    const { url, init } = sentRequest(request);
    expect(url).toBe('https://sms.example.test/api/v5/flow');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ authkey: AUTH_KEY, 'content-type': 'application/json' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('should send the body exactly: digits only, variables in order, short links off', async () => {
    const { request, client } = clientAnswering(ok());

    await client.send(PHONE, SMS);

    expect(sentRequest(request).body).toEqual({
      template_id: 'reg-1001',
      short_url: '0',
      recipients: [{ mobiles: '919000000001', var1: CODE, var2: NAME }],
    });
  });

  it('should add the sender header when configured and the unicode flag when the draft needs it', async () => {
    const { request, client } = clientAnswering(ok(), 'ROVIQS');

    await client.send(PHONE, { ...SMS, variables: ['आरव'], unicode: true });

    expect(sentRequest(request).body).toEqual({
      template_id: 'reg-1001',
      short_url: '0',
      recipients: [{ mobiles: '919000000001', var1: 'आरव' }],
      sender: 'ROVIQS',
      unicode: 1,
    });
  });

  it('should return the request id', async () => {
    const { client } = clientAnswering(ok());

    await expect(client.send(PHONE, SMS)).resolves.toBe('req-abc-1');
  });

  describe('errors', () => {
    it.each<[string, number, unknown, string, boolean]>([
      ['HTTP 401', 401, { type: 'error', message: 'nope' }, 'SMS_SENDER_BLOCKED', false],
      ['HTTP 403', 403, null, 'SMS_SENDER_BLOCKED', false],
      [
        'an auth key text',
        400,
        { type: 'error', message: leaky('Invalid authkey') },
        'SMS_SENDER_BLOCKED',
        false,
      ],
      [
        'an authentication text',
        200,
        { type: 'error', message: leaky('Authentication failure') },
        'SMS_SENDER_BLOCKED',
        false,
      ],
      [
        'a whitelist text',
        200,
        { type: 'error', message: leaky('IP not whitelisted') },
        'SMS_SENDER_BLOCKED',
        false,
      ],
      [
        'a blacklist text',
        200,
        { type: 'error', message: leaky('Number blacklisted') },
        'SMS_SENDER_BLOCKED',
        false,
      ],
      [
        'a balance text',
        200,
        { type: 'error', message: leaky('Insufficient balance'), code: 301 },
        'SMS_SENDER_BLOCKED',
        false,
      ],
      [
        'an account text',
        200,
        { type: 'error', message: leaky('Account suspended') },
        'SMS_SENDER_BLOCKED',
        false,
      ],
      ['HTTP 429', 429, { type: 'error', message: 'slow' }, 'SMS_RATE_LIMITED', true],
      [
        'a too-many text',
        200,
        { type: 'error', message: leaky('Too many requests') },
        'SMS_RATE_LIMITED',
        true,
      ],
      [
        'a rate text',
        200,
        { type: 'error', message: leaky('Rate exceeded') },
        'SMS_RATE_LIMITED',
        true,
      ],
      [
        'a limit text',
        200,
        { type: 'error', message: leaky('Hourly limit reached') },
        'SMS_RATE_LIMITED',
        true,
      ],
      [
        'a template text',
        200,
        { type: 'error', message: leaky('Template not approved') },
        'SMS_TEMPLATE_REJECTED',
        false,
      ],
      [
        'a flow text',
        400,
        { type: 'error', message: leaky('Flow id invalid') },
        'SMS_TEMPLATE_REJECTED',
        false,
      ],
      [
        'a DLT text',
        200,
        { type: 'error', message: leaky('DLT mismatch') },
        'SMS_TEMPLATE_REJECTED',
        false,
      ],
      [
        'a sender id text',
        200,
        { type: 'error', message: leaky('Sender ID unknown') },
        'SMS_TEMPLATE_REJECTED',
        false,
      ],
      [
        'a mobile text',
        200,
        { type: 'error', message: leaky('Invalid mobile') },
        'SMS_INVALID_NUMBER',
        false,
      ],
      [
        'a number text',
        400,
        { type: 'error', message: leaky('Bad number') },
        'SMS_INVALID_NUMBER',
        false,
      ],
      ['HTTP 500', 500, { type: 'error', message: 'oops' }, 'SMS_UNREACHABLE', true],
      ['HTTP 503 without JSON', 503, null, 'SMS_UNREACHABLE', true],
      [
        'an unknown text with HTTP 200',
        200,
        { type: 'error', message: leaky('Something odd') },
        'SMS_REJECTED',
        false,
      ],
      ['HTTP 400 without a text', 400, { type: 'error' }, 'SMS_REJECTED', false],
      ['a 2xx without an id', 200, { type: 'success' }, 'SMS_REJECTED', false],
      ['a 2xx with an empty id', 200, { type: 'success', message: '' }, 'SMS_REJECTED', false],
      [
        'a 2xx whose id is not a string',
        200,
        { type: 'success', message: 7 },
        'SMS_REJECTED',
        false,
      ],
      ['a 2xx that is not an object', 200, ['req-1'], 'SMS_REJECTED', false],
    ])('should map %s to %s (retryable %s)', async (_case, status, body, code, retryable) => {
      const { client } = clientAnswering(jsonResponse(status, body));

      const error = await failureOf(client.send(PHONE, SMS));

      expect(error.code).toBe(code);
      expect(error.retryable).toBe(retryable);
      expectNoSecrets(error);
    });

    it('should keep only the status and a numeric provider code in the message', () => {
      const error = smsErrorFor(200, { type: 'error', message: leaky('Low balance'), code: 301 });

      expect(error.code).toBe('SMS_SENDER_BLOCKED');
      expect(error.message).toBe('http 200, provider code 301');
    });

    it('should map a success answer that is not JSON to SMS_REJECTED', async () => {
      const { client } = clientAnswering(new Response(`ok ${CODE}`, { status: 200 }));

      const error = await failureOf(client.send(PHONE, SMS));

      expect(error.code).toBe('SMS_REJECTED');
      expect(error.retryable).toBe(false);
      expectNoSecrets(error);
    });

    it('should map an error page that is not JSON by its status only', async () => {
      const { client } = clientAnswering(
        new Response(`<html>${leaky('Invalid mobile')}</html>`, { status: 400 }),
      );

      const error = await failureOf(client.send(PHONE, SMS));

      expect(error.code).toBe('SMS_REJECTED');
      expectNoSecrets(error);
    });

    it.each([
      [
        'a network error',
        () => Promise.reject(new TypeError(`fetch failed ${AUTH_KEY} ${PHONE} ${CODE}`)),
      ],
      ['an abort', () => Promise.reject(new DOMException(`aborted ${AUTH_KEY}`, 'TimeoutError'))],
    ])('should map %s to SMS_UNREACHABLE without its cause', async (_case, answer) => {
      const { client } = clientAnswering(answer);

      const error = await failureOf(client.send(PHONE, SMS));

      expect(error.code).toBe('SMS_UNREACHABLE');
      expect(error.retryable).toBe(true);
      expectNoSecrets(error);
    });
  });
});
