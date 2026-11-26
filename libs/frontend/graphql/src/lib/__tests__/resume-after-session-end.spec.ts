import { ApolloClient, gql, InMemoryCache } from '@apollo/client/core';
import { ApolloLink } from '@apollo/client/link';
import { Observable } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { resumeAfterSessionEnd } from '../client';
import { createLiveConnection } from '../live-connection';

const SUBSCRIPTION = gql`
  subscription StudentChanged {
    studentChanged {
      id
    }
  }
`;

const client = new ApolloClient({ link: ApolloLink.empty(), cache: new InMemoryCache() });

/** A socket stand-in: each subscribe runs the next scripted behaviour. */
function scriptedTerminal(
  script: Array<
    (observer: { next: (v: ApolloLink.Result) => void; error: (e: unknown) => void }) => void
  >,
) {
  const subscribes = vi.fn();
  const link = new ApolloLink(
    () =>
      new Observable<ApolloLink.Result>((observer) => {
        const run = script[subscribes.mock.calls.length];
        subscribes();
        run?.(observer);
      }),
  );
  return { link, subscribes };
}

describe('resumeAfterSessionEnd', () => {
  it('holds a subscription that failed because the session ended and restarts it on resume', () => {
    const live = createLiveConnection();
    const { link, subscribes } = scriptedTerminal([
      (o) => {
        o.next({ data: { studentChanged: { id: 's1' } } });
        live.onSessionEnded();
        o.error(new Error('Socket closed with event 4005'));
      },
      (o) => o.next({ data: { studentChanged: { id: 's2' } } }),
    ]);
    const next = vi.fn();
    const error = vi.fn();

    ApolloLink.execute(
      resumeAfterSessionEnd(live).concat(link),
      { query: SUBSCRIPTION },
      { client },
    ).subscribe({
      next,
      error,
    });
    expect(error).not.toHaveBeenCalled();
    expect(subscribes).toHaveBeenCalledTimes(1);

    live.resume();

    expect(subscribes).toHaveBeenCalledTimes(2);
    expect(next.mock.calls.map(([r]) => r.data.studentChanged.id)).toEqual(['s1', 's2']);
    expect(error).not.toHaveBeenCalled();
  });

  it('passes any other error through', () => {
    const live = createLiveConnection();
    const { link } = scriptedTerminal([(o) => o.error(new Error('bad query'))]);
    const error = vi.fn();

    ApolloLink.execute(
      resumeAfterSessionEnd(live).concat(link),
      { query: SUBSCRIPTION },
      { client },
    ).subscribe({
      error,
    });

    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'bad query' }));
  });

  it('does not restart a held subscription the screen already left', () => {
    const live = createLiveConnection();
    const { link, subscribes } = scriptedTerminal([
      (o) => {
        live.onSessionEnded();
        o.error(new Error('Socket closed with event 4005'));
      },
    ]);

    const subscription = ApolloLink.execute(
      resumeAfterSessionEnd(live).concat(link),
      { query: SUBSCRIPTION },
      { client },
    ).subscribe({});
    subscription.unsubscribe();
    live.resume();

    expect(subscribes).toHaveBeenCalledTimes(1);
  });
});
