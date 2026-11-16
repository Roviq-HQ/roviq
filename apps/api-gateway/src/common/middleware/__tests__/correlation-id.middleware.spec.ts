import { createMock } from '@roviq/testing';
import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { CorrelationIdMiddleware } from '../correlation-id.middleware';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('CorrelationIdMiddleware', () => {
  function run(header?: string | string[]) {
    const req = createMock<Request>({ headers: { 'x-correlation-id': header } });
    const res = createMock<Response>();
    const next = vi.fn<NextFunction>();

    new CorrelationIdMiddleware().use(req, res, next);

    expect(res.setHeader).toHaveBeenCalledExactlyOnceWith('x-correlation-id', req.correlationId);
    expect(next).toHaveBeenCalledExactlyOnceWith();
    return req.correlationId;
  }

  it('should generate a UUID when the header is missing', () => {
    expect(run()).toMatch(uuid);
  });

  it('should preserve a client-provided ID', () => {
    expect(run('test-123')).toBe('test-123');
  });

  it('should generate a UUID when the header is empty', () => {
    expect(run('')).toMatch(uuid);
  });

  it('should use the first ID when the header is an array', () => {
    expect(run(['first-id', 'second-id'])).toBe('first-id');
  });

  it('should generate a UUID when the header array is empty', () => {
    expect(run([])).toMatch(uuid);
  });

  it('should assign independent IDs to requests without a header', () => {
    expect(run()).not.toBe(run());
  });
});
