import { buildSchema, type OperationDefinitionNode, parse, validate } from 'graphql';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUERY_LIMITS,
  limitExceeded,
  measureOperation,
  queryLimitsRule,
} from '../query-limits';

function sizeOf(source: string) {
  const document = parse(source);
  const fragments = new Map(
    document.definitions.flatMap((definition) =>
      definition.kind === 'FragmentDefinition'
        ? [[definition.name.value, definition] as const]
        : [],
    ),
  );
  const operation = document.definitions.find(
    (definition): definition is OperationDefinitionNode =>
      definition.kind === 'OperationDefinition',
  );
  if (!operation) throw new Error('no operation in the test document');
  return measureOperation(operation, (name) => fragments.get(name));
}

describe('measureOperation', () => {
  it('should count a root field as depth 1 and each nesting as one more', () => {
    expect(sizeOf('{ a { b { c } } d }')).toEqual({
      depth: 3,
      fields: 4,
      rootFields: 2,
      introspection: false,
    });
  });

  it('should count an alias as a field of its own', () => {
    expect(sizeOf('{ one: a two: a three: a }')).toMatchObject({ fields: 3, rootFields: 3 });
  });

  it('should expand a fragment at every place it is spread', () => {
    const size = sizeOf(`
      query { a { ...F } b { ...F } }
      fragment F on T { x y { z } }
    `);
    expect(size).toMatchObject({ depth: 3, fields: 8, rootFields: 2 });
  });

  it('should count the root fields a fragment or an inline fragment adds', () => {
    const size = sizeOf(`
      query { ...Roots ... on Query { c } }
      fragment Roots on Query { a b }
    `);
    expect(size).toMatchObject({ rootFields: 3, fields: 3, depth: 1 });
  });

  it('should not loop on fragments that spread each other', () => {
    const size = sizeOf(`
      query { a { ...A } }
      fragment A on T { x ...B }
      fragment B on T { y ...A }
    `);
    expect(size.fields).toBe(3);
  });

  it('should recognise an operation that only introspects', () => {
    expect(sizeOf('{ __schema { types { name } } }').introspection).toBe(true);
    expect(sizeOf('{ __schema { types { name } } a }').introspection).toBe(false);
  });
});

describe('limitExceeded', () => {
  const limits = { maxDepth: 3, maxFields: 6, maxRootFields: 2 };

  it('should accept an operation at each limit', () => {
    expect(limitExceeded(sizeOf('{ a { b { c } } d { e f } }'), limits)).toBeNull();
  });

  it('should name the depth limit', () => {
    expect(limitExceeded(sizeOf('{ a { b { c { d } } } }'), limits)).toBe(
      'Query is 4 levels deep; the limit is 3',
    );
  });

  it('should name the root field limit', () => {
    expect(limitExceeded(sizeOf('{ a b c }'), limits)).toBe(
      'Query selects 3 fields at the root; the limit is 2',
    );
  });

  it('should name the field limit', () => {
    expect(limitExceeded(sizeOf('{ a { b c d e f g } }'), limits)).toBe(
      'Query selects 7 fields; the limit is 6',
    );
  });

  it('should let introspection through whatever its size', () => {
    expect(
      limitExceeded(
        sizeOf('{ __schema { types { fields { type { ofType { name } } } } } }'),
        limits,
      ),
    ).toBeNull();
  });

  it('should keep the defaults above zero and in order of size', () => {
    expect(DEFAULT_QUERY_LIMITS.maxRootFields).toBeGreaterThan(0);
    expect(DEFAULT_QUERY_LIMITS.maxDepth).toBeGreaterThan(0);
    expect(DEFAULT_QUERY_LIMITS.maxFields).toBeGreaterThan(DEFAULT_QUERY_LIMITS.maxRootFields);
  });
});

describe('queryLimitsRule', () => {
  const schema = buildSchema('type Query { a: T } type T { b: T name: String }');

  it('should report an operation over the limit with the limit in the message', () => {
    const errors = validate(schema, parse('{ a { b { b { name } } } }'), [
      queryLimitsRule({ maxDepth: 3, maxFields: 50, maxRootFields: 5 }),
    ]);
    expect(errors.map((error) => [error.message, error.extensions.code])).toEqual([
      ['Query is 4 levels deep; the limit is 3', 'QUERY_TOO_LARGE'],
    ]);
  });

  it('should report nothing for an operation within the limits', () => {
    expect(
      validate(schema, parse('{ a { b { name } } }'), [
        queryLimitsRule({ maxDepth: 3, maxFields: 50, maxRootFields: 5 }),
      ]),
    ).toEqual([]);
  });
});
