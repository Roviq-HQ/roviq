import type {
  ApolloServerPlugin,
  BaseContext,
  GraphQLRequestContextWillSendResponse,
  GraphQLRequestListener,
} from '@apollo/server';
import { Plugin } from '@nestjs/apollo';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type AuthUser, ErrorCode } from '@roviq/common-types';
import type { GraphQLResolveInfo } from 'graphql';
import {
  type ExpectedScope,
  findForeignScope,
  isWalkable,
  MAX_SCAN_NODES,
} from './foreign-scope-finder';
import { FOREIGN_SCOPE_ALLOWED } from './response-scope.allowlist';
import { type FailedCheckReason, ResponseScopeGauge } from './response-scope-gauge';

export const RESPONSE_SCOPE_CHECK_MODES = ['refuse', 'report', 'off'] as const;
export type ResponseScopeCheckMode = (typeof RESPONSE_SCOPE_CHECK_MODES)[number];

interface GqlContext extends BaseContext {
  req?: { user?: AuthUser };
}

/** What the caller's own results may carry. Platform callers read every institute. */
export function expectedScopeOf(user: AuthUser | undefined): ExpectedScope | null {
  if (user?.scope === 'institute') return { tenantId: user.tenantId };
  if (user?.scope === 'reseller') return { resellerId: user.resellerId };
  return null;
}

/** The response key of the root field a path belongs to. */
function rootKey(path: GraphQLResolveInfo['path']): string | number {
  let step = path;
  while (step.prev) step = step.prev;
  return step.key;
}

/** What one request has done so far. */
interface RequestState {
  /** Response keys of root fields on the allowed list. */
  allowedRoots: Set<string | number>;
  failed: boolean;
}

const MESSAGE = 'Internal server error';

/**
 * Last check before a response leaves an institute- or reseller-scope query or mutation: every
 * `tenantId` (institute caller) or `resellerId` (reseller caller) in what any resolver returned
 * must be the caller's own. It reads resolved values, not the response, so a column the client
 * did not select is checked too. A failed check replaces the whole response with one error; a
 * mutation's write has committed by then.
 *
 * An Apollo plugin, not a Nest interceptor: `willResolveField` sees every field, so rows a field
 * resolver loads are checked without switching Nest's enhancers on for field resolvers (which
 * would run every global guard and interceptor once per field). Subscriptions over graphql-ws
 * do not pass through Apollo's request pipeline and are not checked.
 */
@Plugin()
export class ResponseScopePlugin implements ApolloServerPlugin<GqlContext> {
  private readonly logger = new Logger(ResponseScopePlugin.name);
  private readonly mode: ResponseScopeCheckMode;
  /** Overridden in tests; see `MAX_SCAN_NODES` for the number. */
  protected readonly maxNodes: number = MAX_SCAN_NODES;

  constructor(
    config: ConfigService,
    private readonly gauge: ResponseScopeGauge,
  ) {
    this.mode = config.get<ResponseScopeCheckMode>('RESPONSE_SCOPE_CHECK') ?? 'refuse';
  }

  async requestDidStart(): Promise<GraphQLRequestListener<GqlContext>> {
    if (this.mode === 'off') return {};
    const state: RequestState = { allowedRoots: new Set(), failed: false };
    return {
      executionDidStart: async () => ({
        willResolveField: ({ source, contextValue, info }) => {
          if (info.operation.operation === 'subscription') return;
          const isRoot = info.path.prev === undefined;
          if (isRoot && info.fieldName in FOREIGN_SCOPE_ALLOWED) {
            state.allowedRoots.add(info.path.key);
            return;
          }
          // Below the root the guards have run: a caller that is never checked costs nothing more.
          if (!isRoot && !expectedScopeOf(contextValue.req?.user)) return;
          return (_error, result) => {
            if (state.failed || !isWalkable(result)) return;
            // A value read straight off its parent was checked when the parent was.
            if (isWalkable(source) && Reflect.get(source, info.fieldName) === result) return;
            this.check(result, contextValue.req?.user, info, state);
          };
        },
      }),
      willSendResponse: async (requestContext) => {
        if (state.failed && this.mode === 'refuse') refuse(requestContext);
      },
    };
  }

  private check(
    value: object,
    user: AuthUser | undefined,
    info: GraphQLResolveInfo,
    state: RequestState,
  ): void {
    const expected = expectedScopeOf(user);
    if (!user || !expected || state.allowedRoots.has(rootKey(info.path))) return;
    const { foreign, truncated } = findForeignScope(value, expected, this.maxNodes);
    if (!foreign && !truncated) return;

    const reason: FailedCheckReason = foreign ? 'foreign_id' : 'too_large';
    const scope = user.scope === 'reseller' ? 'reseller' : 'institute';
    state.failed = true;
    this.gauge.record(scope, reason);
    this.logger.error(
      {
        operation: info.operation.name?.value,
        field: `${info.parentType.name}.${info.fieldName}`,
        scope,
        reason,
        kind: foreign?.kind,
        expected: foreign ? expected[foreign.kind] : undefined,
        found: foreign?.found,
        refused: this.mode === 'refuse',
      },
      foreign
        ? "A result carried an id outside the caller's scope"
        : "A result was too large to check against the caller's scope",
    );
  }
}

/** Replaces the whole response: the caller gets no part of the data that failed the check. */
function refuse(requestContext: GraphQLRequestContextWillSendResponse<GqlContext>): void {
  const { body } = requestContext.response;
  const error = {
    message: MESSAGE,
    extensions: { code: ErrorCode.INTERNAL_ERROR, statusCode: 500 },
  };
  if (body.kind === 'single') {
    body.singleResult = { data: null, errors: [error] };
    return;
  }
  body.initialResult = { data: null, errors: [error], hasNext: false };
  body.subsequentResults = (async function* () {})();
}
