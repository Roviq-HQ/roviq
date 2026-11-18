import { Global, Injectable, Module, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export interface ConnectionCounts {
  websocket: number;
  http: number;
}

/** Per-process counters of live graphql-ws connections and in-flight HTTP requests. */
@Injectable()
export class ConnectionTracker {
  private websocket = 0;
  private http = 0;

  websocketOpened(): void {
    this.websocket += 1;
  }

  websocketClosed(): void {
    this.websocket = Math.max(0, this.websocket - 1);
  }

  httpStarted(): void {
    this.http += 1;
  }

  httpFinished(): void {
    this.http = Math.max(0, this.http - 1);
  }

  snapshot(): ConnectionCounts {
    return { websocket: this.websocket, http: this.http };
  }
}

@Injectable()
export class InFlightRequestMiddleware implements NestMiddleware {
  constructor(private readonly tracker: ConnectionTracker) {}

  use(_req: Request, res: Response, next: NextFunction): void {
    this.tracker.httpStarted();
    // 'close' fires for both completed and aborted responses, so the count cannot leak.
    res.once('close', () => this.tracker.httpFinished());
    next();
  }
}

@Global()
@Module({
  providers: [ConnectionTracker, InFlightRequestMiddleware],
  exports: [ConnectionTracker, InFlightRequestMiddleware],
})
export class ConnectionTrackerModule {}
