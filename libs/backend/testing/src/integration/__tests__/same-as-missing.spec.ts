import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { idOfNoRow, requestSameAsMissing, rootFieldOf } from '../same-as-missing';

const HOLIDAY = /* GraphQL */ `
  query Holiday($id: ID!) {
    holiday(id: $id) {
      id
    }
  }
`;
const FOREIGN = '01939c1e-0000-7000-8000-00000000000b';

type Answer = (variables: Record<string, unknown>) => unknown;

let server: Server | undefined;

/** A GraphQL endpoint that answers every request with `answer(variables)`. */
function serve(answer: Answer): { server: Server; seen: Record<string, unknown>[] } {
  const seen: Record<string, unknown>[] = [];
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const { variables } = JSON.parse(body) as { variables: Record<string, unknown> };
      seen.push(variables);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(answer(variables)));
    });
  });
  return { server, seen };
}

const notFound = (message: string) => ({
  data: null,
  errors: [{ message, path: ['holiday'], extensions: { code: 'HOLIDAY_NOT_FOUND' } }],
});

afterEach(() => {
  server?.close();
  server = undefined;
});

describe('requestSameAsMissing', () => {
  it('should send the request again with an id of no row and pass when both answers match', async () => {
    const { server, seen } = serve((variables) => notFound(`Holiday ${variables.id} not found`));

    const outcome = await requestSameAsMissing(
      server,
      { query: HOLIDAY, variables: { id: FOREIGN } },
      [FOREIGN],
    );

    expect(outcome.compared).toBe(true);
    expect(outcome.operation).toBe('holiday');
    expect(outcome.response.errors?.[0]?.extensions?.code).toBe('HOLIDAY_NOT_FOUND');
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({ id: FOREIGN });
    expect(seen[1]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-/);
    expect(seen[1]?.id).not.toBe(FOREIGN);
  });

  it.each([
    [
      'another error code',
      (id: unknown) =>
        id === FOREIGN
          ? {
              data: null,
              errors: [{ message: 'Not found', extensions: { code: 'FORBIDDEN' } }],
            }
          : notFound('Not found'),
    ],
    [
      'another message',
      (id: unknown) => notFound(id === FOREIGN ? 'Holiday of another institute' : 'Not found'),
    ],
    [
      'data instead of an error',
      (id: unknown) =>
        id === FOREIGN ? { data: { holiday: { id: 'x' } } } : notFound('Not found'),
    ],
  ])('should fail when the other institute id gets %s', async (_label, answer) => {
    const { server } = serve((variables) => answer(variables.id));

    await expect(
      requestSameAsMissing(server, { query: HOLIDAY, variables: { id: FOREIGN } }, [FOREIGN]),
    ).rejects.toThrow(/holiday answers differently/);
  });

  it('should replace a foreign id at any depth of the variables', async () => {
    const { server, seen } = serve(() => notFound('Not found'));

    await requestSameAsMissing(
      server,
      { query: HOLIDAY, variables: { input: { own: 'kept', rows: [{ sectionId: FOREIGN }] } } },
      [FOREIGN],
    );

    const rows = (seen[1]?.input as { own: string; rows: { sectionId: string }[] }).rows;
    expect(rows[0]?.sectionId).not.toBe(FOREIGN);
    expect((seen[1]?.input as { own: string }).own).toBe('kept');
  });

  it('should send the request once and report it as not compared when no variable is foreign', async () => {
    const { server, seen } = serve(() => ({ data: { holiday: { id: 'own' } } }));

    const outcome = await requestSameAsMissing(
      server,
      { query: HOLIDAY, variables: { id: idOfNoRow() } },
      [FOREIGN],
    );

    expect(outcome.compared).toBe(false);
    expect(seen).toHaveLength(1);
  });

  it('should apply the normalizer to both answers before comparing', async () => {
    let call = 0;
    const { server } = serve(() => {
      call += 1;
      return { data: { holiday: { id: 'x', renderedAt: call } } };
    });

    const outcome = await requestSameAsMissing(
      server,
      { query: HOLIDAY, variables: { id: FOREIGN } },
      [FOREIGN],
      () => 'same',
    );

    expect(outcome.compared).toBe(true);
  });
});

describe('rootFieldOf', () => {
  it('should name the first field of the operation', () => {
    expect(rootFieldOf('mutation M($id: ID!) { deleteHoliday(id: $id) }')).toBe('deleteHoliday');
  });
});
