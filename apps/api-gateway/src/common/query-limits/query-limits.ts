import type { ConfigService } from '@nestjs/config';
import {
  type ASTVisitor,
  type FragmentDefinitionNode,
  GraphQLError,
  Kind,
  type OperationDefinitionNode,
  type SelectionSetNode,
  type ValidationContext,
} from 'graphql';

/** How large one GraphQL operation may be. Values and what they were measured against: docs/auth.md → "Request limits". */
export interface QueryLimits {
  /** Deepest nesting of fields; a root field is depth 1. */
  maxDepth: number;
  /** Fields selected in the whole operation, fragments expanded, each occurrence counted. */
  maxFields: number;
  /** Fields selected at the root, aliases counted one each. */
  maxRootFields: number;
}

export const DEFAULT_QUERY_LIMITS: QueryLimits = {
  maxDepth: 12,
  maxFields: 400,
  maxRootFields: 10,
};

/** The limits in force: each default unless its variable sets another value. */
export function queryLimitsFrom(config: Pick<ConfigService, 'get'>): QueryLimits {
  const read = (name: string, fallback: number): number => Number(config.get(name) ?? fallback);
  return {
    maxDepth: read('GRAPHQL_MAX_DEPTH', DEFAULT_QUERY_LIMITS.maxDepth),
    maxFields: read('GRAPHQL_MAX_FIELDS', DEFAULT_QUERY_LIMITS.maxFields),
    maxRootFields: read('GRAPHQL_MAX_ROOT_FIELDS', DEFAULT_QUERY_LIMITS.maxRootFields),
  };
}

export interface OperationSize {
  depth: number;
  fields: number;
  rootFields: number;
  /** Every root field is `__schema`, `__type` or `__typename`. */
  introspection: boolean;
}

type FragmentLookup = (name: string) => FragmentDefinitionNode | null | undefined;

interface Tally {
  depth: number;
  fields: number;
}

/** A field count no real operation reaches: counting stops there, so a hostile document costs little to refuse. */
const COUNT_CEILING = 100_000;

function walk(
  set: SelectionSetNode,
  depth: number,
  fragment: FragmentLookup,
  open: Set<string>,
  tally: Tally,
  roots: string[] | null,
): void {
  for (const selection of set.selections) {
    if (tally.fields > COUNT_CEILING) return;
    if (selection.kind === Kind.FIELD) {
      tally.fields += 1;
      tally.depth = Math.max(tally.depth, depth);
      roots?.push(selection.name.value);
      if (selection.selectionSet) {
        walk(selection.selectionSet, depth + 1, fragment, open, tally, null);
      }
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      walk(selection.selectionSet, depth, fragment, open, tally, roots);
    } else {
      const name = selection.name.value;
      const definition = fragment(name);
      // A cycle is refused by GraphQL's own rule; here it only must not loop.
      if (!definition || open.has(name)) continue;
      open.add(name);
      walk(definition.selectionSet, depth, fragment, open, tally, roots);
      open.delete(name);
    }
  }
}

/** Depth and field counts of one operation, with its fragments expanded where they are spread. */
export function measureOperation(
  operation: OperationDefinitionNode,
  fragment: FragmentLookup,
): OperationSize {
  const tally: Tally = { depth: 0, fields: 0 };
  const roots: string[] = [];
  walk(operation.selectionSet, 1, fragment, new Set(), tally, roots);
  return {
    depth: tally.depth,
    fields: tally.fields,
    rootFields: roots.length,
    introspection: roots.length > 0 && roots.every((name) => name.startsWith('__')),
  };
}

/** The limit an operation of this size goes over, as the message the caller gets; null when it fits. */
export function limitExceeded(size: OperationSize, limits: QueryLimits): string | null {
  if (size.introspection) return null;
  if (size.depth > limits.maxDepth) {
    return `Query is ${size.depth} levels deep; the limit is ${limits.maxDepth}`;
  }
  if (size.rootFields > limits.maxRootFields) {
    return `Query selects ${size.rootFields} fields at the root; the limit is ${limits.maxRootFields}`;
  }
  if (size.fields > limits.maxFields) {
    const counted = size.fields > COUNT_CEILING ? `more than ${COUNT_CEILING}` : `${size.fields}`;
    return `Query selects ${counted} fields; the limit is ${limits.maxFields}`;
  }
  return null;
}

/**
 * A GraphQL validation rule that refuses an operation over the limits before any resolver
 * runs. Introspection is measured by nobody: it is switched off in production, and the
 * schema download in development is deeper than any operation of the app.
 */
export function queryLimitsRule(limits: QueryLimits) {
  return (context: ValidationContext): ASTVisitor => ({
    OperationDefinition(node) {
      const refusal = limitExceeded(
        measureOperation(node, (name) => context.getFragment(name)),
        limits,
      );
      if (refusal) {
        context.reportError(
          new GraphQLError(refusal, { nodes: node, extensions: { code: 'QUERY_TOO_LARGE' } }),
        );
      }
    },
  });
}
