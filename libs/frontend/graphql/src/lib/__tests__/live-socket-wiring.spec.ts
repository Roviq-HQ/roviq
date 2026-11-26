import { describe, expect, it, vi } from 'vitest';
import { bindBrowserConnectivity, liveSocketHandlers, loadedPastFirstPage } from '../client';
import { createLiveConnection } from '../live-connection';

describe('liveSocketHandlers', () => {
  it('maps socket events onto the connection state, close codes included', () => {
    const live = createLiveConnection();
    const on = liveSocketHandlers(live, vi.fn());

    on.connecting();
    expect(live.getSnapshot().status).toBe('connecting');
    on.connected({}, undefined, false);
    expect(live.getSnapshot().status).toBe('connected');
    on.closed({ code: 1006, reason: '' });
    expect(live.getSnapshot()).toEqual({ status: 'reconnecting', failedAttempts: 1 });
    on.closed({ code: 1000, reason: 'Normal Closure' });
    expect(live.getSnapshot().status).toBe('idle');
  });

  it('does not refetch on the first connection', () => {
    const live = createLiveConnection();
    const refetch = vi.fn();
    liveSocketHandlers(live, refetch).connected({}, undefined, false);
    expect(refetch).not.toHaveBeenCalled();
  });

  it('refetches once after a reconnect, not again for a second reconnect right after', () => {
    const live = createLiveConnection();
    const refetch = vi.fn();
    const on = liveSocketHandlers(live, refetch);
    on.connected({}, undefined, false);

    on.closed({ code: 1006, reason: '' });
    on.connected({}, undefined, true);
    on.closed({ code: 1006, reason: '' });
    on.connected({}, undefined, true);

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does not refetch after a reconnect that follows a re-login refetch', () => {
    const live = createLiveConnection();
    const refetch = vi.fn();
    const on = liveSocketHandlers(live, refetch);
    on.connected({}, undefined, false);
    on.closed({ code: 1006, reason: '' });

    expect(live.claimRefetch()).toBe(true); // the re-login refetched the screen
    on.connected({}, undefined, true);

    expect(refetch).not.toHaveBeenCalled();
  });
});

describe('bindBrowserConnectivity', () => {
  it('goes offline and drops the socket, comes back online, and stops listening on cleanup', () => {
    const target = new EventTarget();
    const live = createLiveConnection();
    const terminate = vi.fn();
    live.setTerminate(terminate);
    live.onConnected();

    const unbind = bindBrowserConnectivity(target, live);
    target.dispatchEvent(new Event('offline'));
    expect(live.getSnapshot().status).toBe('offline');
    expect(terminate).toHaveBeenCalledTimes(1);

    target.dispatchEvent(new Event('online'));
    expect(live.getSnapshot().status).toBe('reconnecting');

    unbind();
    target.dispatchEvent(new Event('offline'));
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(live.getSnapshot().status).toBe('reconnecting');
  });
});

describe('loadedPastFirstPage', () => {
  const page = (n: number) => ({ list: { edges: Array.from({ length: n }, (_, i) => ({ i })) } });

  it('is true when the list on screen holds more than the first page', () => {
    expect(loadedPastFirstPage({ filter: { first: 25 } }, page(50))).toBe(true);
    expect(loadedPastFirstPage({ first: 10 }, page(11))).toBe(true);
  });

  it('is false for a first page, or a query with no page size', () => {
    expect(loadedPastFirstPage({ filter: { first: 25 } }, page(25))).toBe(false);
    expect(loadedPastFirstPage({ id: 'x' }, page(80))).toBe(false);
    expect(loadedPastFirstPage(undefined, undefined)).toBe(false);
  });
});
