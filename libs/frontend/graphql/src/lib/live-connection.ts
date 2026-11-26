export type LiveConnectionStatus =
  /** No live data on screen, so no socket. */
  | 'idle'
  | 'connecting'
  | 'connected'
  /** The socket dropped while live data was on screen; graphql-ws is retrying. */
  | 'reconnecting'
  | 'offline'
  /** The session ended; live updates wait for the next sign-in or a manual reconnect. */
  | 'session-ended';

export interface LiveConnectionState {
  status: LiveConnectionStatus;
  /** Failed attempts since the last successful connection. */
  failedAttempts: number;
}

export interface LiveConnection {
  getSnapshot: () => LiveConnectionState;
  subscribe: (listener: () => void) => () => void;
  /** Stops waiting for the next retry and connects now; also restarts held subscriptions. */
  reconnectNow: () => void;
  /** Restarts the subscriptions held since the session ended (called after a re-login). */
  resume: () => void;
  isSessionEnded: () => boolean;
  /** Runs `start` again on `resume()`; returns a function that forgets it. */
  holdUntilResume: (start: () => void) => () => void;
  waitBeforeRetry: (delayMs: number) => Promise<void>;
  onConnecting: () => void;
  onConnected: () => void;
  /** `code` 1000 is the client closing an unused socket, not a failure. */
  onClosed: (code: number | undefined) => void;
  onSessionEnded: () => void;
  /** graphql-ws stopped retrying (a close code it treats as final); only a manual reconnect helps. */
  onGaveUp: () => void;
  setOnline: (online: boolean) => void;
}

/** A manual Reconnect is offered after this many failed attempts in a row. */
export const MANUAL_RECONNECT_AFTER = 3;

const NORMAL_CLOSURE = 1000;

export function createLiveConnection(initiallyOnline = true): LiveConnection {
  let state: LiveConnectionState = {
    status: initiallyOnline ? 'idle' : 'offline',
    failedAttempts: 0,
  };
  let online = initiallyOnline;
  let sessionEnded = false;
  let everConnected = false;
  let statusBeforeOffline: LiveConnectionStatus = 'idle';
  const listeners = new Set<() => void>();
  const held = new Set<() => void>();
  const pendingWaits = new Set<() => void>();

  const set = (next: Partial<LiveConnectionState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  // graphql-ws keeps counting failures across restarts, so the wait it asks for next can start
  // after the reconnect was asked for: that one is skipped too.
  let skipNextWait = false;
  const releaseWaits = () => {
    skipNextWait = pendingWaits.size === 0;
    for (const release of [...pendingWaits]) release();
  };

  const resume = () => {
    sessionEnded = false;
    set({ status: online ? 'connecting' : 'offline', failedAttempts: 0 });
    for (const start of [...held]) {
      held.delete(start);
      start();
    }
    releaseWaits();
  };

  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reconnectNow: () => {
      if (sessionEnded || held.size > 0) resume();
      releaseWaits();
    },
    resume,
    isSessionEnded: () => sessionEnded,
    holdUntilResume: (start) => {
      held.add(start);
      return () => held.delete(start);
    },
    waitBeforeRetry: (delayMs) =>
      new Promise<void>((resolve) => {
        if (skipNextWait) {
          skipNextWait = false;
          resolve();
          return;
        }
        const release = () => {
          clearTimeout(timer);
          pendingWaits.delete(release);
          resolve();
        };
        const timer = setTimeout(release, delayMs);
        pendingWaits.add(release);
      }),
    onConnecting: () => {
      if (sessionEnded || !online) return;
      if (state.status === 'idle') set({ status: 'connecting' });
    },
    onConnected: () => {
      everConnected = true;
      set({ status: 'connected', failedAttempts: 0 });
    },
    onClosed: (code) => {
      if (sessionEnded) return;
      if (code === NORMAL_CLOSURE) {
        set({ status: online ? 'idle' : 'offline', failedAttempts: 0 });
        return;
      }
      const failedAttempts = state.failedAttempts + 1;
      if (!online) {
        set({ status: 'offline', failedAttempts });
        return;
      }
      set({ status: everConnected ? 'reconnecting' : 'connecting', failedAttempts });
      if (!everConnected && failedAttempts >= MANUAL_RECONNECT_AFTER) {
        set({ status: 'reconnecting' });
      }
    },
    onSessionEnded: () => {
      sessionEnded = true;
      set({ status: 'session-ended' });
    },
    onGaveUp: () => {
      if (sessionEnded) return;
      set({
        status: online ? 'reconnecting' : 'offline',
        failedAttempts: Math.max(state.failedAttempts, MANUAL_RECONNECT_AFTER),
      });
    },
    setOnline: (next) => {
      online = next;
      if (!next) {
        if (sessionEnded) return;
        statusBeforeOffline = state.status;
        set({ status: 'offline' });
        return;
      }
      if (sessionEnded) return;
      if (state.status === 'offline') {
        set({ status: statusBeforeOffline === 'idle' ? 'idle' : 'reconnecting' });
      }
      releaseWaits();
    },
  };
}
