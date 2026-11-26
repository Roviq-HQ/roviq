import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLiveConnection,
  MANUAL_RECONNECT_AFTER,
  REFETCH_COALESCE_MS,
} from '../live-connection';

const ABNORMAL = 1006;
const NORMAL = 1000;

describe('createLiveConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts idle, connects, and goes idle again when the last subscription closes the socket', () => {
    const live = createLiveConnection();
    expect(live.getSnapshot()).toEqual({ status: 'idle', failedAttempts: 0 });

    live.onConnecting();
    expect(live.getSnapshot().status).toBe('connecting');
    live.onConnected();
    expect(live.getSnapshot().status).toBe('connected');
    live.onClosed(NORMAL);
    expect(live.getSnapshot()).toEqual({ status: 'idle', failedAttempts: 0 });
  });

  it('counts failed attempts after a drop and resets them on the next connection', () => {
    const live = createLiveConnection();
    live.onConnected();

    for (let i = 0; i < MANUAL_RECONNECT_AFTER; i++) live.onClosed(ABNORMAL);
    expect(live.getSnapshot()).toEqual({
      status: 'reconnecting',
      failedAttempts: MANUAL_RECONNECT_AFTER,
    });

    live.onConnected();
    expect(live.getSnapshot()).toEqual({ status: 'connected', failedAttempts: 0 });
  });

  it('reports reconnecting only after the first connection failed a few times', () => {
    const live = createLiveConnection();
    live.onConnecting();
    live.onClosed(ABNORMAL);
    expect(live.getSnapshot().status).toBe('connecting');

    for (let i = 1; i < MANUAL_RECONNECT_AFTER; i++) live.onClosed(ABNORMAL);
    expect(live.getSnapshot().status).toBe('reconnecting');
  });

  it('waits for the retry delay, or less when reconnectNow is pressed', async () => {
    const live = createLiveConnection();
    const waited = vi.fn();
    void live.waitBeforeRetry(30_000).then(waited);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(waited).not.toHaveBeenCalled();

    live.reconnectNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(waited).toHaveBeenCalledTimes(1);
  });

  it('goes offline, and on coming back online retries at once with the failure count cleared', async () => {
    const live = createLiveConnection();
    live.onConnected();
    const waited = vi.fn();
    void live.waitBeforeRetry(30_000).then(waited);

    live.setOnline(false);
    live.onClosed(4499);
    live.onClosed(ABNORMAL);
    expect(live.getSnapshot()).toEqual({ status: 'offline', failedAttempts: 2 });

    live.setOnline(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(live.getSnapshot()).toEqual({ status: 'reconnecting', failedAttempts: 0 });
    expect(waited).toHaveBeenCalledTimes(1);
  });

  it('coming online with nothing waiting does not skip a later wait', async () => {
    const live = createLiveConnection();
    live.onConnected();
    live.setOnline(false);
    live.setOnline(true);

    const waited = vi.fn();
    void live.waitBeforeRetry(2_000).then(waited);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(waited).not.toHaveBeenCalled();
  });

  it('returns to idle after offline when no live data was on screen', () => {
    const live = createLiveConnection();
    live.setOnline(false);
    expect(live.getSnapshot().status).toBe('offline');
    live.setOnline(true);
    expect(live.getSnapshot().status).toBe('idle');
  });

  it('holds subscriptions once the session ended and restarts them on resume', () => {
    const live = createLiveConnection();
    const start = vi.fn();
    live.onSessionEnded();
    expect(live.isSessionEnded()).toBe(true);
    live.holdUntilResume(start);

    live.onClosed(4005);
    expect(live.getSnapshot().status).toBe('session-ended');
    expect(start).not.toHaveBeenCalled();

    live.resume();
    expect(start).toHaveBeenCalledTimes(1);
    expect(live.isSessionEnded()).toBe(false);
    expect(live.getSnapshot()).toEqual({ status: 'connecting', failedAttempts: 0 });
  });

  it.each([
    ['connected', (live: ReturnType<typeof createLiveConnection>) => live.onConnected()],
    ['idle', () => {}],
  ])('resume while %s changes nothing (a re-login with live updates working)', (status, arrange) => {
    const live = createLiveConnection();
    arrange(live);
    const listener = vi.fn();
    live.subscribe(listener);

    live.resume();

    expect(live.getSnapshot().status).toBe(status);
    expect(listener).not.toHaveBeenCalled();
  });

  it('skips the one wait graphql-ws asks for right after a resume, and only that one', async () => {
    const live = createLiveConnection();
    live.onSessionEnded();
    live.resume();
    const waited = vi.fn();

    void live.waitBeforeRetry(30_000).then(waited);
    await vi.advanceTimersByTimeAsync(0);
    expect(waited).toHaveBeenCalledTimes(1);

    const later = vi.fn();
    void live.waitBeforeRetry(30_000).then(later);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(later).not.toHaveBeenCalled();
  });

  it('marks a view-as session end separately, and Reconnect does nothing there', () => {
    const live = createLiveConnection();
    const start = vi.fn();
    live.onSessionEnded('impersonation');
    live.holdUntilResume(start);
    expect(live.getSnapshot().status).toBe('impersonation-ended');

    live.reconnectNow();
    expect(start).not.toHaveBeenCalled();
  });

  it('reconnectNow after the session ended restarts held subscriptions', () => {
    const live = createLiveConnection();
    const start = vi.fn();
    live.onSessionEnded();
    live.holdUntilResume(start);

    live.reconnectNow();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('when graphql-ws gave up: stopped, later closes ignored, Reconnect restarts held work', () => {
    const live = createLiveConnection();
    const start = vi.fn();
    live.onConnected();
    live.onGaveUp();
    live.holdUntilResume(start);
    live.onClosed(1011);
    expect(live.getSnapshot().status).toBe('stopped');

    live.reconnectNow();
    expect(start).toHaveBeenCalledTimes(1);
    expect(live.getSnapshot().status).toBe('connecting');
  });

  it('restarts held subscriptions when another subscription brings the socket back', () => {
    const live = createLiveConnection();
    const start = vi.fn();
    live.onConnected();
    live.onGaveUp();
    live.holdUntilResume(start);

    live.onConnected();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('does not restart a held subscription that was unsubscribed', () => {
    const live = createLiveConnection();
    const start = vi.fn();
    live.onSessionEnded();
    const forget = live.holdUntilResume(start);
    forget();

    live.resume();
    expect(start).not.toHaveBeenCalled();
  });

  it('allows one refetch per reconnect window', () => {
    let clock = 1_000;
    const live = createLiveConnection(true, () => clock);
    expect(live.claimRefetch()).toBe(true);
    clock += REFETCH_COALESCE_MS - 1;
    expect(live.claimRefetch()).toBe(false);
    clock += 1;
    expect(live.claimRefetch()).toBe(true);
  });

  it('terminate calls what the client set', () => {
    const live = createLiveConnection();
    const terminate = vi.fn();
    live.setTerminate(terminate);
    live.terminate();
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('notifies listeners on every change', () => {
    const live = createLiveConnection();
    const listener = vi.fn();
    const unsubscribe = live.subscribe(listener);
    live.onConnecting();
    live.onConnected();
    unsubscribe();
    live.onClosed(ABNORMAL);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
