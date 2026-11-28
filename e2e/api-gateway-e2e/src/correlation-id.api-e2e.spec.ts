import { describe, expect, it } from 'vitest';

const apiUrl =
  process.env.API_URL || `http://localhost:${process.env.E2E_API_PORT ?? '3004'}/api/graphql`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Raw fetch exposes response headers, which the shared GraphQL helper omits.
function query(headers: Record<string, string> = {}) {
  return fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ query: '{ __typename }' }),
  });
}

describe('HTTP request correlation', () => {
  it('should generate distinct UUIDs for requests without a header', async () => {
    const first = await query();
    const second = await query();

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ data: { __typename: 'Query' } });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ data: { __typename: 'Query' } });
    expect(first.headers.get('x-correlation-id')).toMatch(uuid);
    expect(second.headers.get('x-correlation-id')).toMatch(uuid);
    expect(first.headers.get('x-correlation-id')).not.toBe(second.headers.get('x-correlation-id'));
  });

  it('should echo a client-provided ID', async () => {
    const response = await query({ 'x-correlation-id': 'test-123' });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-correlation-id')).toBe('test-123');
    expect(await response.json()).toEqual({ data: { __typename: 'Query' } });
  });

  it('should generate a UUID for an empty header', async () => {
    const response = await query({ 'x-correlation-id': '' });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-correlation-id')).toMatch(uuid);
  });

  it.each([
    ['/', 404],
    ['/api', 404],
    ['/api/health/ready', 200],
    ['/missing-route', 404],
    ['/api/missing-route', 404],
  ])('should assign an ID on %s, including routes outside the API prefix', async (path, status) => {
    const response = await fetch(new URL(path, apiUrl));

    expect(response.status).toBe(status);
    expect(response.headers.get('x-correlation-id')).toMatch(uuid);
  });

  it('should preserve the ID on malformed request bodies', async () => {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-correlation-id': 'malformed-body' },
      body: '{',
    });

    expect(response.status).toBe(400);
    expect(response.headers.get('x-correlation-id')).toBe('malformed-body');
  });

  it('should preserve the ID on forbidden GraphQL requests', async () => {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-correlation-id': 'unauthenticated' },
      body: JSON.stringify({ query: '{ me { id } }' }),
    });
    const result = await response.json();

    expect(response.headers.get('x-correlation-id')).toBe('unauthenticated');
    expect(result.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });
});
