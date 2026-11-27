// The request helper of the foreign-id specs. A request that names a row of another institute
// or reseller is sent twice, the second time with an id of no row, and the two answers must be
// the same (`requestSameAsMissing`). When the spec file ends, every operation that
// `FOREIGN_ID_COVERAGE` points at this file must have been compared, or be listed with a reason.

import type { Server } from 'node:http';
import { join, relative, sep } from 'node:path';
import { EventBusService } from '@roviq/event-bus';
import {
  type GqlRequestOptions,
  type GqlResponse,
  requestSameAsMissing,
  rootFieldOf,
} from '@roviq/testing/integration';
import { afterAll, expect, vi } from 'vitest';
import { FOREIGN_ID_COVERAGE } from './foreign-id-coverage';

const ROOT = join(__dirname, '../../../..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ForeignIdRequestsSetup {
  httpServer: () => Server;
  /**
   * Everything the caller must not be able to see: ids, or objects and arrays holding them
   * (a fixture of the other institute). Every UUID inside is taken.
   */
  foreignIds: () => unknown;
  /**
   * The tokens of the callers that must not see `foreignIds`. A request with any other token
   * (the other institute acting on its own rows) is sent once, as given. Leave out when every
   * request of the spec comes from such a caller.
   */
  callerTokens?: () => readonly string[];
  /** `__filename` of the spec. */
  specFile: string;
  /**
   * Operations this file covers that are not compared with an id of no row, each with the
   * reason (for example: the foreign value is not an id the operation looks up).
   */
  notCompared?: Readonly<Record<string, string>>;
  /**
   * Per operation, a function that removes from the data what differs between any two
   * answers, before the two are compared.
   */
  normalize?: Readonly<Record<string, (data: unknown) => unknown>>;
}

export type ForeignIdRequest = <T = unknown>(options: GqlRequestOptions) => Promise<GqlResponse<T>>;

/**
 * A base64 PDF without its creation time and document id, which differ on every render.
 * List it under `normalize` for an operation that returns one PDF.
 */
export function pdfWithoutStamp(data: unknown): unknown {
  if (data === null || typeof data !== 'object') return data;
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      typeof value === 'string'
        ? Buffer.from(value, 'base64')
            .toString('latin1')
            .replace(/\/CreationDate \([^)]*\)/g, '')
            .replace(/\/ID \[[^\]]*\]/g, '')
        : value,
    ]),
  );
}

function collectIds(value: unknown, into: Set<string>): Set<string> {
  if (typeof value === 'string') {
    if (UUID.test(value)) into.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectIds(item, into);
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectIds(item, into);
  }
  return into;
}

/** The operations `FOREIGN_ID_COVERAGE` points at `specFile`. */
export function operationsCoveredBy(specFile: string): string[] {
  const path = relative(ROOT, specFile).split(sep).join('/');
  return Object.entries(FOREIGN_ID_COVERAGE)
    .filter(([, coverage]) => 'spec' in coverage && coverage.spec === path)
    .map(([name]) => name)
    .sort();
}

/**
 * Build the request function of a foreign-id spec. Call it once, inside the top `describe`.
 * A request with none of the foreign ids in its variables is sent once, as given.
 */
export function foreignIdRequests(setup: ForeignIdRequestsSetup): ForeignIdRequest {
  const compared = new Set<string>();
  const notCompared = setup.notCompared ?? {};

  afterAll(() => {
    const covered = operationsCoveredBy(setup.specFile);
    const unproved = covered.filter((name) => !compared.has(name) && !(name in notCompared));
    expect(
      unproved,
      'operations of this spec never compared with an id of no row (use the request helper for their foreign-id test, or list them in notCompared with the reason)',
    ).toEqual([]);
    const stale = Object.keys(notCompared).filter(
      (name) => compared.has(name) || !covered.includes(name),
    );
    expect(stale, 'notCompared lists operations that are compared or not covered here').toEqual([]);
    const unexplained = Object.entries(notCompared)
      .filter(([, reason]) => reason.trim().length < 20)
      .map(([name]) => name);
    expect(unexplained, 'notCompared entries without a reason').toEqual([]);
  });

  return async <T = unknown>(options: GqlRequestOptions): Promise<GqlResponse<T>> => {
    const callers = setup.callerTokens?.();
    const fromCaller = callers === undefined || callers.includes(options.token ?? '');
    const foreignIds = fromCaller ? collectIds(setup.foreignIds(), new Set()) : new Set<string>();
    const alreadySpied = vi.isMockFunction(EventBusService.prototype.emit);
    const emit = vi.spyOn(EventBusService.prototype, 'emit');
    const emittedBefore = emit.mock.calls.length;
    try {
      const outcome = await requestSameAsMissing<T>(
        setup.httpServer(),
        options,
        foreignIds,
        setup.normalize?.[rootFieldOf(options.query)],
      );
      if (outcome.compared) {
        const refused = (outcome.response.errors?.length ?? 0) > 0;
        if (refused) {
          expect(
            emit.mock.calls.slice(emittedBefore).map(([pattern]) => pattern),
            `${outcome.operation} emitted an event on a refused request`,
          ).toEqual([]);
        }
        compared.add(outcome.operation);
      }
      return outcome.response;
    } finally {
      if (!alreadySpied) emit.mockRestore();
    }
  };
}
