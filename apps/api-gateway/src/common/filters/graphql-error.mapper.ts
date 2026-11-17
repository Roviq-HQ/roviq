import { HttpException, HttpStatus } from '@nestjs/common';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import { GraphQLError, type GraphQLFormattedError } from 'graphql';

const INTERNAL_MESSAGE = 'Internal server error';

const STATUS_FALLBACK_CODE: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ErrorCode.UNPROCESSABLE_ENTITY,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.TOO_MANY_REQUESTS,
};

export interface StructuredError {
  message: string;
  code: string;
  statusCode: number;
}

function readMessage(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'object' && 'message' in response && Array.isArray(response.message)) {
    return response.message.join('; ');
  }
  return exception.message;
}

export function toStructuredError(exception: unknown): StructuredError {
  if (!(exception instanceof HttpException)) {
    return {
      message: INTERNAL_MESSAGE,
      code: ErrorCode.INTERNAL_ERROR,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    };
  }

  const statusCode = exception.getStatus();
  const code =
    exception instanceof BusinessException
      ? exception.code
      : (STATUS_FALLBACK_CODE[statusCode] ??
        (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR
          ? ErrorCode.INTERNAL_ERROR
          : ErrorCode.BAD_REQUEST));

  return { message: readMessage(exception), code, statusCode };
}

/** True when the failure is a server fault whose details must be logged, not shown. */
export function isServerFault(exception: unknown): boolean {
  return (
    !(exception instanceof HttpException) ||
    exception.getStatus() >= HttpStatus.INTERNAL_SERVER_ERROR
  );
}

export function toGraphQLError(exception: unknown): GraphQLError {
  const { message, code, statusCode } = toStructuredError(exception);
  return new GraphQLError(message, {
    extensions: { code, statusCode },
    // Keeps the throw site in dev stacktraces; never serialized to clients.
    originalError: exception instanceof Error ? exception : undefined,
  });
}

// `instanceof GraphQLError` breaks when graphql is loaded twice (its CJS and
// ESM builds under Vitest), so identify it the way graphql-js does.
function isGraphQLError(value: unknown): value is GraphQLError {
  return (
    value instanceof Error && Object.prototype.toString.call(value) === '[object GraphQLError]'
  );
}

/** graphql-js wraps whatever a resolver threw in a located GraphQLError. */
function unwrapResolverError(error: unknown): unknown {
  return isGraphQLError(error) && error.path && error.originalError ? error.originalError : error;
}

export interface GraphqlErrorFormatterOptions {
  /** Called for server faults that never passed through `GraphqlExceptionFilter` (field resolvers, field middleware). */
  onUnhandled: (thrown: unknown) => void;
}

/**
 * Apollo `formatError`: the last stop for every error on the HTTP transport.
 * Errors already shaped by the filter, and graphql-js / Apollo request errors,
 * pass through; anything else is mapped here so no path leaks raw internals.
 */
export function createGraphqlErrorFormatter({ onUnhandled }: GraphqlErrorFormatterOptions) {
  return (formatted: GraphQLFormattedError, error: unknown): GraphQLFormattedError => {
    const thrown = unwrapResolverError(error);
    if (isGraphQLError(thrown)) return formatted;

    if (isServerFault(thrown)) onUnhandled(thrown);

    const { message, code, statusCode } = toStructuredError(thrown);
    const stacktrace = formatted.extensions?.stacktrace;
    return {
      message,
      ...(formatted.locations ? { locations: formatted.locations } : {}),
      ...(formatted.path ? { path: formatted.path } : {}),
      extensions: { code, statusCode, ...(stacktrace ? { stacktrace } : {}) },
    };
  };
}
