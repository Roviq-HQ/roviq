import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import { type AuthUser, BusinessException, ErrorCode } from '@roviq/common-types';
import { map, type Observable } from 'rxjs';
import { type ExpectedScope, findForeignScope } from './foreign-scope-finder';
import { FOREIGN_SCOPE_ALLOWED } from './response-scope.allowlist';
import { ResponseScopeGauge } from './response-scope-gauge';

export const RESPONSE_SCOPE_CHECK_MODES = ['refuse', 'report', 'off'] as const;
export type ResponseScopeCheckMode = (typeof RESPONSE_SCOPE_CHECK_MODES)[number];

/** What the caller's own results may carry. Platform callers read every institute. */
export function expectedScopeOf(user: AuthUser | undefined): ExpectedScope | null {
  if (user?.scope === 'institute') return { tenantId: user.tenantId };
  if (user?.scope === 'reseller') return { resellerId: user.resellerId };
  return null;
}

/**
 * Last check before a result leaves an institute- or reseller-scope query or mutation: every
 * `tenantId` (institute caller) or `resellerId` (reseller caller) in what the resolver returned
 * must be the caller's own. It reads the resolver's value, not the GraphQL response, so a column
 * the client did not select is checked too. A mutation is refused after its write committed.
 */
@Injectable()
export class ResponseScopeInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ResponseScopeInterceptor.name);
  private readonly mode: ResponseScopeCheckMode;

  constructor(
    config: ConfigService,
    private readonly gauge: ResponseScopeGauge,
  ) {
    this.mode = config.get<ResponseScopeCheckMode>('RESPONSE_SCOPE_CHECK') ?? 'refuse';
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.mode === 'off' || context.getType<GqlContextType>() !== 'graphql') {
      return next.handle();
    }
    const gql = GqlExecutionContext.create(context);
    const info = gql.getInfo();
    const parent: string = info.parentType.name;
    if (parent !== 'Query' && parent !== 'Mutation') return next.handle();
    const operation: string = info.fieldName;
    if (operation in FOREIGN_SCOPE_ALLOWED) return next.handle();

    return next.handle().pipe(
      map((value) => {
        // Read after the handler: a guard set req.user by now.
        const user: AuthUser | undefined = gql.getContext().req?.user;
        const expected = expectedScopeOf(user);
        if (!user || !expected) return value;
        const { foreign, truncated } = findForeignScope(value, expected);
        if (truncated) {
          this.logger.warn({ operation }, 'Result too large to check in full for foreign ids');
        }
        if (!foreign) return value;

        const scope = user.scope === 'reseller' ? 'reseller' : 'institute';
        this.gauge.record(scope);
        this.logger.error(
          {
            operation,
            scope,
            kind: foreign.kind,
            expected: expected[foreign.kind],
            found: foreign.found,
            refused: this.mode === 'refuse',
          },
          "A result carried an id outside the caller's scope",
        );
        if (this.mode === 'refuse') {
          throw new BusinessException(ErrorCode.INTERNAL_ERROR, 'The response could not be sent');
        }
        return value;
      }),
    );
  }
}
