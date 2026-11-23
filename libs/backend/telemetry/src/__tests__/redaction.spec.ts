import { describe, expect, it } from 'vitest';
import {
  isUntracedPath,
  serializeRedisCommand,
  serializeRequest,
  serializeResponse,
} from '../redaction';

describe('serializeRequest', () => {
  it('should keep the request line and drop headers, body and remote address', () => {
    const req = {
      id: 'req-1',
      method: 'POST',
      url: '/api/graphql',
      headers: { authorization: 'Bearer secret', cookie: 'refresh=secret' },
      remoteAddress: '203.0.113.7',
      body: { variables: { password: 'secret' } },
    };

    expect(serializeRequest(req)).toEqual({ id: 'req-1', method: 'POST', url: '/api/graphql' });
  });

  it('should drop the query string', () => {
    expect(serializeRequest({ id: 1, method: 'GET', url: '/api/files?code=one-time' })).toEqual({
      id: 1,
      method: 'GET',
      url: '/api/files',
    });
  });
});

describe('serializeResponse', () => {
  it('should keep the status and drop headers', () => {
    const res = { statusCode: 200, headers: { 'set-cookie': ['refresh=secret'] } };

    expect(serializeResponse(res)).toEqual({ statusCode: 200 });
  });
});

describe('serializeRedisCommand', () => {
  it('should export the command name only', () => {
    expect(serializeRedisCommand('del')).toBe('del');
  });
});

describe('isUntracedPath', () => {
  it('should skip the health endpoints under the global prefix', () => {
    expect(isUntracedPath('/api/health')).toBe(true);
    expect(isUntracedPath('/api/health/ready')).toBe(true);
  });

  it('should trace application requests', () => {
    expect(isUntracedPath('/api/graphql')).toBe(false);
    expect(isUntracedPath(undefined)).toBe(false);
  });
});
