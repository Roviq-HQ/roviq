import { describe, expect, it } from 'vitest';
import { isNetworkError } from '../extract-graphql-error';
import { NetworkFetchError, tagNetworkFailures } from '../network-fetch';

function failingFetch(error: unknown): typeof fetch {
  return () => Promise.reject(error);
}

function bodyThatDrops(error: unknown): ReadableStream<Uint8Array> {
  let sent = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent) {
        controller.error(error);
        return;
      }
      sent = true;
      controller.enqueue(new TextEncoder().encode('{"data":'));
    },
  });
}

describe('tagNetworkFailures', () => {
  it('turns a rejected request into a NetworkFetchError, whatever the browser says', async () => {
    for (const message of [
      'Failed to fetch',
      'The Internet connection appears to be offline.',
      'Die Netzwerkverbindung wurde unterbrochen.',
    ]) {
      const tagged = tagNetworkFailures(failingFetch(new TypeError(message)));
      const error = await tagged('https://api.test/graphql').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(NetworkFetchError);
      expect(isNetworkError(error)).toBe(true);
    }
  });

  it('turns a connection that drops while the body is read into a NetworkFetchError', async () => {
    const response = new Response(bodyThatDrops(new TypeError('network error')), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const tagged = tagNetworkFailures(() => Promise.resolve(response));

    const received = await tagged('https://api.test/graphql');
    const error = await received.text().catch((e: unknown) => e);

    expect(received.status).toBe(200);
    expect(received.headers.get('content-type')).toBe('application/json');
    expect(error).toBeInstanceOf(NetworkFetchError);
    expect(isNetworkError(error)).toBe(true);
  });

  it('passes a complete response through unchanged', async () => {
    const tagged = tagNetworkFailures(() =>
      Promise.resolve(new Response('{"data":{}}', { status: 200 })),
    );
    const received = await tagged('https://api.test/graphql');
    expect(await received.text()).toBe('{"data":{}}');
  });

  it('rethrows a cancelled request as it is, not as a network failure', async () => {
    const controller = new AbortController();
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    controller.abort(abortError);
    const tagged = tagNetworkFailures(failingFetch(abortError));

    const error = await tagged('https://api.test/graphql', { signal: controller.signal }).catch(
      (e: unknown) => e,
    );

    expect(error).toBe(abortError);
    expect(isNetworkError(error)).toBe(false);
  });
});
