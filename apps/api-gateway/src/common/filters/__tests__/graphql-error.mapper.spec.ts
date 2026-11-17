import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import { GraphQLError, type GraphQLFormattedError } from 'graphql';
import { describe, expect, it, vi } from 'vitest';
import {
  createGraphqlErrorFormatter,
  isServerFault,
  toGraphQLError,
  toStructuredError,
} from '../graphql-error.mapper';

describe('toStructuredError', () => {
  it('should use the BusinessException code and its mapped status', () => {
    const result = toStructuredError(
      new BusinessException(ErrorCode.PASSKEY_CHALLENGE_EXPIRED, 'Challenge expired or not found'),
    );

    expect(result).toEqual({
      message: 'Challenge expired or not found',
      code: 'PASSKEY_CHALLENGE_EXPIRED',
      statusCode: 400,
    });
  });

  it('should honour an explicit code on a plain HttpException response', () => {
    const result = toStructuredError(
      new NotFoundException({ message: 'Student not found', code: 'STUDENT_NOT_FOUND' }),
    );

    expect(result).toEqual({
      message: 'Student not found',
      code: 'STUDENT_NOT_FOUND',
      statusCode: 404,
    });
  });

  it.each([
    [new BadRequestException('bad'), 'BAD_REQUEST', 400],
    [new UnauthorizedException(), 'UNAUTHENTICATED', 401],
    [new ForbiddenException('nope'), 'FORBIDDEN', 403],
    [new NotFoundException('gone'), 'NOT_FOUND', 404],
    [new ConflictException('dup'), 'CONFLICT', 409],
    [new UnprocessableEntityException('rule'), 'UNPROCESSABLE_ENTITY', 422],
    [new HttpException('slow down', 429), 'TOO_MANY_REQUESTS', 429],
    [new HttpException('teapot', 418), 'BAD_REQUEST', 418],
    [new InternalServerErrorException('boom'), 'INTERNAL_ERROR', 500],
  ])('should derive the code from the HTTP status for %s', (exception, code, statusCode) => {
    expect(toStructuredError(exception)).toEqual({
      message: exception.message,
      code,
      statusCode,
    });
  });

  it('should ignore a response code that is not UPPER_SNAKE', () => {
    const result = toStructuredError(new BadRequestException({ message: 'bad', code: 'oops' }));

    expect(result.code).toBe('BAD_REQUEST');
  });

  it('should join class-validator message arrays', () => {
    const result = toStructuredError(
      new BadRequestException({ message: ['name should not be empty', 'code must be a string'] }),
    );

    expect(result.message).toBe('name should not be empty; code must be a string');
  });

  it('should mask non-HTTP errors so internals never reach the client', () => {
    const result = toStructuredError(new Error('relation "users" does not exist'));

    expect(result).toEqual({
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
      statusCode: 500,
    });
  });

  it('should mask thrown non-Error values', () => {
    expect(toStructuredError('raw string')).toEqual({
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
      statusCode: 500,
    });
  });
});

describe('isServerFault', () => {
  it('should treat non-HTTP errors and 5xx as server faults', () => {
    expect(isServerFault(new Error('boom'))).toBe(true);
    expect(isServerFault(new InternalServerErrorException())).toBe(true);
  });

  it('should treat 4xx as client faults', () => {
    expect(isServerFault(new ForbiddenException())).toBe(false);
    expect(isServerFault(new BusinessException(ErrorCode.INVALID_CREDENTIALS, 'x'))).toBe(false);
  });
});

describe('toGraphQLError', () => {
  it('should expose only code and statusCode in extensions', () => {
    const error = toGraphQLError(
      new BusinessException(ErrorCode.INVALID_CREDENTIALS, 'Invalid credentials'),
    );

    expect(error).toBeInstanceOf(GraphQLError);
    expect(error.message).toBe('Invalid credentials');
    expect(error.extensions).toEqual({ code: 'INVALID_CREDENTIALS', statusCode: 401 });
  });
});

describe('createGraphqlErrorFormatter', () => {
  const path = ['adminLogin'];
  const locations = [{ line: 1, column: 12 }];

  function resolverError(thrown: Error): GraphQLError {
    return new GraphQLError(thrown.message, { path, originalError: thrown });
  }

  it('should pass through errors already shaped by the exception filter', () => {
    const onUnhandled = vi.fn();
    const format = createGraphqlErrorFormatter({ onUnhandled });
    const formatted: GraphQLFormattedError = {
      message: 'Invalid credentials',
      path,
      extensions: { code: 'INVALID_CREDENTIALS', statusCode: 401 },
    };
    const shaped = new GraphQLError('Invalid credentials', {
      extensions: { code: 'INVALID_CREDENTIALS', statusCode: 401 },
    });

    expect(format(formatted, resolverError(shaped))).toBe(formatted);
    expect(onUnhandled).not.toHaveBeenCalled();
  });

  it('should pass through graphql-js request errors untouched', () => {
    const format = createGraphqlErrorFormatter({ onUnhandled: vi.fn() });
    const formatted: GraphQLFormattedError = {
      message: 'Cannot query field "nope" on type "Query".',
      extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
    };

    expect(format(formatted, new GraphQLError(formatted.message))).toBe(formatted);
  });

  it('should recognise GraphQL errors from a second copy of the graphql package', () => {
    // Same shape as graphql-js's class, but not an instance of the one imported here.
    class GraphQLError extends Error {
      readonly path = path;
      constructor(
        message: string,
        readonly originalError?: Error,
      ) {
        super(message);
      }
      get [Symbol.toStringTag]() {
        return 'GraphQLError';
      }
    }
    const onUnhandled = vi.fn();
    const format = createGraphqlErrorFormatter({ onUnhandled });
    const thrown = new ForbiddenException('reseller scope required');
    const requestError: GraphQLFormattedError = {
      message: 'Syntax Error: Unexpected Name "nope".',
      extensions: { code: 'GRAPHQL_PARSE_FAILED' },
    };

    const mapped = format(
      { message: thrown.message, path, extensions: { code: 'INTERNAL_SERVER_ERROR' } },
      new GraphQLError(thrown.message, thrown),
    );
    const passedThrough = format(requestError, new GraphQLError(requestError.message));

    expect(mapped.extensions).toEqual({ code: 'FORBIDDEN', statusCode: 403 });
    expect(passedThrough).toBe(requestError);
    expect(onUnhandled).not.toHaveBeenCalled();
  });

  it('should map an HttpException that bypassed the filter', () => {
    const onUnhandled = vi.fn();
    const format = createGraphqlErrorFormatter({ onUnhandled });
    const thrown = new ForbiddenException('Institute read authorization is required');

    const result = format(
      { message: thrown.message, path, locations, extensions: { code: 'INTERNAL_SERVER_ERROR' } },
      resolverError(thrown),
    );

    expect(result).toEqual({
      message: 'Institute read authorization is required',
      path,
      locations,
      extensions: { code: 'FORBIDDEN', statusCode: 403 },
    });
    expect(onUnhandled).not.toHaveBeenCalled();
  });

  it('should mask and report an unexpected error that bypassed the filter', () => {
    const onUnhandled = vi.fn();
    const format = createGraphqlErrorFormatter({ onUnhandled });
    const thrown = new Error('connect ECONNREFUSED 10.0.0.5:5432');

    const result = format(
      { message: thrown.message, path, extensions: { code: 'INTERNAL_SERVER_ERROR' } },
      resolverError(thrown),
    );

    expect(result).toEqual({
      message: 'Internal server error',
      path,
      extensions: { code: 'INTERNAL_ERROR', statusCode: 500 },
    });
    expect(onUnhandled).toHaveBeenCalledWith(thrown);
  });

  it('should keep the stacktrace only when Apollo attached one', () => {
    const format = createGraphqlErrorFormatter({ onUnhandled: vi.fn() });
    const thrown = new NotFoundException('gone');
    const stacktrace = ['NotFoundException: gone', '    at resolver (file.ts:1:1)'];

    const result = format(
      { message: 'gone', path, extensions: { code: 'INTERNAL_SERVER_ERROR', stacktrace } },
      resolverError(thrown),
    );

    expect(result.extensions).toEqual({ code: 'NOT_FOUND', statusCode: 404, stacktrace });
  });
});
