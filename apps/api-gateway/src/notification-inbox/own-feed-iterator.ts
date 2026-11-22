/**
 * Maps each pubsub event through `load` and yields only the non-null results.
 * `return()` goes straight to the source so a closed socket frees its pubsub listener
 * even while `next()` is still waiting for the next event.
 */
export function ownFeedIterator<E, R>(
  source: AsyncIterator<E>,
  load: (event: E) => Promise<R | null>,
): AsyncIterableIterator<R> {
  let closed = false;
  const done = (): IteratorReturnResult<undefined> => ({ done: true, value: undefined });
  const close = async () => {
    closed = true;
    await source.return?.();
  };
  const iterator: AsyncIterableIterator<R> = {
    async next() {
      // A pull made after the source was closed would never settle.
      while (!closed) {
        const step = await source.next();
        if (step.done) return done();
        const value = await load(step.value);
        if (value !== null && !closed) return { done: false, value };
      }
      return done();
    },
    async return() {
      await close();
      return done();
    },
    async throw(error?: unknown) {
      await close();
      throw error;
    },
    [Symbol.asyncIterator]() {
      return iterator;
    },
  };
  return iterator;
}
