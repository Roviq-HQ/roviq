/**
 * The size limits of a GraphQL operation through the real server: an operation over a limit
 * is refused at validation, before any resolver runs, and the message names the limit.
 */
import {
  createIntegrationApp,
  gqlRequest,
  type IntegrationAppResult,
} from '@roviq/testing/integration';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';
import { DEFAULT_QUERY_LIMITS } from '../query-limits';

describe('GraphQL operation size limits (integration)', () => {
  let result: IntegrationAppResult;

  /** Validation refusals are HTTP 400, which `gqlRequest` treats as a broken test. */
  async function send(query: string) {
    const response = await request(result.httpServer)
      .post('/api/graphql')
      .set('Content-Type', 'application/json')
      .send({ query });
    return response.body as { data?: unknown; errors?: { message: string }[] };
  }

  beforeAll(async () => {
    result = await createIntegrationApp({ modules: [AppModule] });
  });

  afterAll(async () => {
    await result?.close();
  });

  it('should answer an operation with as many root fields as the limit', async () => {
    const fields = Array.from(
      { length: DEFAULT_QUERY_LIMITS.maxRootFields },
      (_, index) => `e${index}: edition`,
    );

    const response = await gqlRequest<Record<string, string>>(result.httpServer, {
      query: `{ ${fields.join(' ')} }`,
    });

    expect(response.errors).toBeUndefined();
    expect(Object.keys(response.data ?? {})).toHaveLength(DEFAULT_QUERY_LIMITS.maxRootFields);
  });

  it('should refuse one more root field and run none of them', async () => {
    const fields = Array.from(
      { length: DEFAULT_QUERY_LIMITS.maxRootFields + 1 },
      (_, index) => `e${index}: edition`,
    );

    const response = await send(`{ ${fields.join(' ')} }`);

    expect(response.data).toBeUndefined();
    expect(response.errors?.map((error) => error.message)).toEqual([
      `Query selects ${DEFAULT_QUERY_LIMITS.maxRootFields + 1} fields at the root; the limit is ${DEFAULT_QUERY_LIMITS.maxRootFields}`,
    ]);
  });

  it('should refuse an operation nested deeper than the limit', async () => {
    const depth = DEFAULT_QUERY_LIMITS.maxDepth + 1;
    // The field names need not exist: the size is judged from the document alone.
    const nested = `${'a { '.repeat(depth - 1)}a${' }'.repeat(depth - 1)}`;

    const response = await send(`{ ${nested} }`);

    expect(response.data).toBeUndefined();
    expect(response.errors?.map((error) => error.message)).toContain(
      `Query is ${depth} levels deep; the limit is ${DEFAULT_QUERY_LIMITS.maxDepth}`,
    );
  });

  it('should refuse an operation that selects more fields than the limit', async () => {
    const inner = Array.from({ length: 50 }, (_, index) => `f${index}: name`).join(' ');
    const outer = Array.from({ length: 9 }, (_, index) => `o${index}: a { ${inner} }`).join(' ');

    const response = await send(`{ ${outer} }`);

    expect(response.data).toBeUndefined();
    expect(response.errors?.map((error) => error.message)).toContain(
      `Query selects 459 fields; the limit is ${DEFAULT_QUERY_LIMITS.maxFields}`,
    );
  });

  it('should still serve the schema download, which is deeper than any operation of the app', async () => {
    const typeRef = `${'ofType { kind name '.repeat(DEFAULT_QUERY_LIMITS.maxDepth)}${'}'.repeat(DEFAULT_QUERY_LIMITS.maxDepth)}`;

    const response = await gqlRequest<{ __schema: { types: unknown[] } }>(result.httpServer, {
      query: `{ __schema { types { name fields { name type { kind name ${typeRef} } } } } }`,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.__schema.types.length).toBeGreaterThan(10);
  });
});
