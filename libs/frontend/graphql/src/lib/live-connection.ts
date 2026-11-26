export type LiveConnectionStatus =
  /** No live data on screen, so no socket. */
  | 'idle'
  | 'connecting'
  | 'connected'
  /** The socket dropped while live data was on screen; graphql-ws is retrying. */
  | 'reconnecting'
  /** graphql-ws met a close it does not retry; only a manual reconnect starts it again. */
  | 'stopped'
  | 'offline'
  /** The sign-in ended; live updates wait for the next sign-in or a manual reconnect. */
  | 'session-ended'
  /** The view-as session of this tab ended; nothing here can start it again. */
  | 'impersonation-ended';

export interface LiveConnectionState {
  status: LiveConnectionStatus;
  /** Failed attempts since the last successful connection. */
  failedAttempts: number;
}

export interface LiveConnection {
  getSnapshot: () => LiveConnectionState;
  subscribe: (listener: () => void) => () => void;
  /** Connects now instead of waiting; also restarts held subscriptions. */
  reconnectNow: () => void;
  /** Restarts the subscriptions held since the session ended (called after a re-login). */
  resume: () => void;
  isSessionEnded: () => boolean;
  /** Runs `start` again on resume or reconnect; returns a function that forgets it. */
  holdUntilResume: (start: () => void) => () => void;
  waitBeforeRetry: (delayMs: number) => Promise<void>;
  onConnecting: () => void;
  onConnected: () => void;
  /** `code` 1000 is the client closing an unused socket, not a failure. */
  onClosed: (code: number | undefined) => void;
  onSessionEnded: (kind?: 'session' | 'impersonation') => void;
  onGaveUp: () => void;
  setOnline: (online: boolean) => void;
  /** Drops the socket at once (set by the client); used when the device goes offline. */
  setTerminate: (terminate: () => void) => void;
  terminate: () => void;
  /** True if the queries on screen were not reloaded in the last few seconds; claims the slot. */
  claimRefetch: () => boolean;
}

/** A manual Reconnect is offered after this many failed attempts in a row. */
export const MANUAL_RECONNECT_AFTER = 3;

/** One refetch per reconnect: a re-login refetch and the reconnect that follows are one event. */
export const REFETCH_COALESCE_MS = 5_000;

const NORMAL_CLOSURE = 1000;

export function createLiveConnection(
  initiallyOnline = true,
  now: () => number = Date.now,
): LiveConnection {
  let state: LiveConnectionState = {
    status: initiallyOnline ? 'idle' : 'offline',
    failedAttempts: 0,
  };
  let online = initiallyOnline;
  let sessionEnded = false;
  let everConnected = false;
  let statusBeforeOffline: LiveConnectionStatus = 'idle';
  // graphql-ws asks for its wait after a restart has begun; a restart asked for by the person
  // (or a re-login) skips that one wait. Cleared once connected, so it never lingers.
  let skipNextWait = false;
  let lastRefetchAt = Number.NEGATIVE_INFINITY;
  let terminateSocket: () => void = () => {};
  const listeners = new Set<() => void>();
  const held = new Set<() => void>();
  const pendingWaits = new Set<() => void>();

  const set = (next: Partial<LiveConnectionState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  const releaseWaits = () => {
    for (const release of [...pendingWaits]) release();
  };

  const restartHeld = () => {
    for (const start of [...held]) {
      held.delete(start);
      start();
    }
  };

  const resume = () => {
    if (!sessionEnded && held.size === 0) return;
    sessionEnded = false;
    skipNextWait = true;
    set({ status: online ? 'connecting' : 'offline', failedAttempts: 0 });
    restartHeld();
    releaseWaits();
  };

  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reconnectNow: () => {
      if (state.status === 'impersonation-ended') return;
      if (sessionEnded || held.size > 0) {
        resume();
        return;
      }
      skipNextWait = pendingWaits.size === 0;
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
      skipNextWait = false;
      set({ status: 'connected', failedAttempts: 0 });
      // A subscription held after a final close starts again on any working socket.
      if (!sessionEnded) restartHeld();
    },
    onClosed: (code) => {
      if (sessionEnded || state.status === 'stopped') return;
      if (code === NORMAL_CLOSURE) {
        set({ status: online ? 'idle' : 'offline', failedAttempts: 0 });
        return;
      }
      const failedAttempts = state.failedAttempts + 1;
      if (!online) {
        set({ status: 'offline', failedAttempts });
        return;
      }
      const quietFirstAttempts = !everConnected && failedAttempts < MANUAL_RECONNECT_AFTER;
      set({ status: quietFirstAttempts ? 'connecting' : 'reconnecting', failedAttempts });
    },
    onSessionEnded: (kind = 'session') => {
      sessionEnded = true;
      set({ status: kind === 'impersonation' ? 'impersonation-ended' : 'session-ended' });
    },
    onGaveUp: () => {
      if (sessionEnded) return;
      set({ status: 'stopped' });
    },
    setOnline: (next) => {
      online = next;
      if (!next) {
        if (sessionEnded) return;
        statusBeforeOffline = state.status;
        set({ status: 'offline' });
        return;
      }
      if (sessionEnded || state.status !== 'offline') return;
      // Failures counted while offline say nothing about the server.
      set({
        status: statusBeforeOffline === 'idle' ? 'idle' : 'reconnecting',
        failedAttempts: 0,
      });
      releaseWaits();
    },
    setTerminate: (terminate) => {
      terminateSocket = terminate;
    },
    terminate: () => terminateSocket(),
    claimRefetch: () => {
      if (now() - lastRefetchAt < REFETCH_COALESCE_MS) return false;
      lastRefetchAt = now();
      return true;
    },
  };
}
