/**
 * The GraphQL request got no complete reply: offline, DNS, refused, CORS, or the connection
 * dropped while the body was read. Browsers word this differently and localize it, so it is
 * recognized by where it was thrown, never by its message.
 */
export class NetworkFetchError extends Error {
  override readonly name = 'NetworkFetchError';

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}

function tag(error: unknown, signal: AbortSignal | null | undefined): unknown {
  // A cancelled request is not a failure: Apollo expects the abort reason back as it is.
  if (signal?.aborted || error instanceof NetworkFetchError) return error;
  return new NetworkFetchError(error);
}

function tagBodyFailures(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | null | undefined,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        controller.error(tag(error, signal));
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/**
 * Engines differ in what `text()` rejects with when the body stream fails (some wrap the
 * stream's error), so the read is tagged here as well as in the stream Apollo may read directly.
 */
class TaggedResponse extends Response {
  readonly #signal: AbortSignal | null | undefined;

  constructor(response: Response, signal: AbortSignal | null | undefined) {
    super(response.body ? tagBodyFailures(response.body, signal) : null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    this.#signal = signal;
  }

  override async text(): Promise<string> {
    try {
      return await super.text();
    } catch (error) {
      throw tag(error, this.#signal);
    }
  }
}

/** Wraps `fetch` so every transport failure, before or during the body, is a `NetworkFetchError`. */
export function tagNetworkFailures(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const signal = init?.signal;
    let response: Response;
    try {
      response = await fetchImpl(input, init);
    } catch (error) {
      throw tag(error, signal);
    }
    if (!response.body) return response;
    return new TaggedResponse(response, signal);
  };
}
