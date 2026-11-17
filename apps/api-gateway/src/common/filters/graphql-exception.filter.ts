import { type ArgumentsHost, Catch, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { GqlArgumentsHost, type GqlContextType } from '@nestjs/graphql';
import type { GraphQLError } from 'graphql';
import { isServerFault, toGraphQLError } from './graphql-error.mapper';

interface GqlRequestContext {
  req?: { correlationId?: string };
}

/**
 * Turns every exception raised in a GraphQL handler (guards, pipes,
 * interceptors, resolvers — HTTP and graphql-ws alike) into a GraphQL error
 * carrying `extensions.{ code, statusCode }`. Non-GraphQL routes keep Nest's
 * default HTTP handling.
 */
@Catch()
export class GraphqlExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(GraphqlExceptionFilter.name);

  override catch(exception: unknown, host: ArgumentsHost): GraphQLError | undefined {
    if (host.getType<GqlContextType>() !== 'graphql') {
      super.catch(exception, host);
      return undefined;
    }

    const gqlError = toGraphQLError(exception);
    const gqlHost = GqlArgumentsHost.create(host);
    const logContext = {
      correlationId: gqlHost.getContext<GqlRequestContext>().req?.correlationId,
      field: gqlHost.getInfo<{ fieldName?: string } | undefined>()?.fieldName,
      code: gqlError.extensions.code,
    };

    if (isServerFault(exception)) {
      this.logger.error({ ...logContext, err: exception }, 'Unhandled GraphQL exception');
    } else {
      this.logger.debug({ ...logContext, reason: gqlError.message }, 'GraphQL request rejected');
    }

    return gqlError;
  }
}
