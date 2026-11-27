import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { Kind, parse } from 'graphql';
import { type GqlRequestOptions, type GqlResponse, gqlRequest } from './gql-request.js';

/** What a caller can tell apart: the error codes, messages and paths, and the data. */
export interface ComparableAnswer {
  data: unknown;
  errors: Array<{ code: unknown; message: string; path: unknown }> | undefined;
}

export interface SameAsMissingResult<T> {
  /** The answer to the request as given, with the other institute's id. */
  response: GqlResponse<T>;
  /** The root field of the request, for example `updateHoliday`. */
  operation: string;
  /** False when no variable held one of the foreign ids: the request was sent once, as given. */
  compared: boolean;
}

const ID_MARK = '<id>';

/** A UUIDv7 of this moment that names no row: the shape every id argument accepts. */
export function idOfNoRow(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = 0x70 | (bytes[6] & 0x0f);
  bytes[8] = 0x80 | (bytes[8] & 0x3f);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The root field name of a GraphQL document with one operation. */
export function rootFieldOf(query: string): string {
  for (const definition of parse(query).definitions) {
    if (definition.kind !== Kind.OPERATION_DEFINITION) continue;
    const first = definition.selectionSet.selections[0];
    if (first?.kind === Kind.FIELD) return first.name.value;
  }
  throw new Error('rootFieldOf: the document has no operation with a field');
}

/** Copy `value`, replacing every string that is a key of `swaps` with its replacement. */
function swapIds<V>(value: V, swaps: ReadonlyMap<string, string>, used: Set<string>): V {
  if (typeof value === 'string') {
    const replacement = swaps.get(value);
    if (replacement === undefined) return value;
    used.add(value);
    return replacement as V;
  }
  if (Array.isArray(value)) return value.map((item) => swapIds(item, swaps, used)) as V;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, swapIds(item, swaps, used)]),
    ) as V;
  }
  return value;
}

function comparable(
  response: GqlResponse,
  ids: readonly string[],
  normalizeData: (data: unknown) => unknown,
): ComparableAnswer {
  const answer: ComparableAnswer = {
    data: normalizeData(response.data ?? null),
    errors: response.errors?.map((error) => ({
      code: error.extensions?.code,
      message: error.message,
      path: error.path,
    })),
  };
  let text = JSON.stringify(answer);
  for (const id of ids) text = text.split(id).join(ID_MARK);
  return JSON.parse(text) as ComparableAnswer;
}

/**
 * Send a request that names a row of another institute (or reseller), then the same request
 * with each of those ids replaced by an id of no row, and fail unless the two answers are
 * the same: error code, message, path and data. An operation that answers differently tells
 * the caller that the row exists somewhere else.
 *
 * `foreignIds` are the ids the caller must not be able to see. Every variable value equal to
 * one of them, at any depth, is replaced for the second request.
 */
export async function requestSameAsMissing<T = unknown>(
  httpServer: Server,
  options: GqlRequestOptions,
  foreignIds: Iterable<string>,
  /** Removes what differs between any two answers (a creation time inside a PDF). */
  normalizeData: (data: unknown) => unknown = (data) => data,
): Promise<SameAsMissingResult<T>> {
  const operation = rootFieldOf(options.query);
  const swaps = new Map([...foreignIds].map((id) => [id, idOfNoRow()]));
  const used = new Set<string>();
  const missingVariables = swapIds(options.variables ?? {}, swaps, used);

  const response = await gqlRequest<T>(httpServer, options);
  if (used.size === 0) return { response, operation, compared: false };

  const missing = await gqlRequest<T>(httpServer, { ...options, variables: missingVariables });
  const ids = [...swaps.keys(), ...swaps.values()];
  const foreignAnswer = comparable(response, ids, normalizeData);
  const missingAnswer = comparable(missing, ids, normalizeData);
  if (JSON.stringify(foreignAnswer) !== JSON.stringify(missingAnswer)) {
    throw new Error(
      [
        `${operation} answers differently for another institute's id and for an id of no row.`,
        `  another institute's id: ${JSON.stringify(foreignAnswer)}`,
        `  an id of no row:        ${JSON.stringify(missingAnswer)}`,
      ].join('\n'),
    );
  }
  return { response, operation, compared: true };
}
