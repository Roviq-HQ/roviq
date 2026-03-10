import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const CORRELATION_HEADER = 'x-correlation-id';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const raw = req.headers[CORRELATION_HEADER];
    const correlationId = (Array.isArray(raw) ? raw[0] : raw) ?? randomUUID();

    req.correlationId = correlationId;
    res.setHeader(CORRELATION_HEADER, correlationId);

    next();
  }
}
