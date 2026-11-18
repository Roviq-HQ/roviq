import { EventEmitter } from 'node:events';
import { createMock } from '@roviq/testing';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionTracker, InFlightRequestMiddleware } from '../connections/connection-tracker';

describe('ConnectionTracker', () => {
  it('should count websocket opens and closes without going negative', () => {
    const tracker = new ConnectionTracker();

    tracker.websocketOpened();
    tracker.websocketOpened();
    tracker.websocketClosed();
    tracker.websocketClosed();
    tracker.websocketClosed();

    expect(tracker.snapshot()).toEqual({ websocket: 0, http: 0 });
  });
});

describe('InFlightRequestMiddleware', () => {
  it('should count a request until its response closes, once', () => {
    const tracker = new ConnectionTracker();
    const middleware = new InFlightRequestMiddleware(tracker);
    const emitter = new EventEmitter();
    const res: Response = createMock<Response>({
      once: vi.fn((event: string, listener: () => void): Response => {
        emitter.once(event, listener);
        return res;
      }),
    });
    const next = vi.fn();

    middleware.use(createMock<Request>(), res, next);
    expect(tracker.snapshot().http).toBe(1);
    expect(next).toHaveBeenCalledTimes(1);

    emitter.emit('close');
    emitter.emit('close');
    expect(tracker.snapshot().http).toBe(0);
  });
});
