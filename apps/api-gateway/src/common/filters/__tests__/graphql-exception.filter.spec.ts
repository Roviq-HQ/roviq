import { type ArgumentsHost, ForbiddenException, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import { createMock } from '@roviq/testing';
import { GraphQLError } from 'graphql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphqlExceptionFilter } from '../graphql-exception.filter';

const CORRELATION_ID = '0190a1b2-0000-7000-8000-000000000001';

function graphqlHost(): ArgumentsHost {
  const args = [
    undefined,
    {},
    { req: { correlationId: CORRELATION_ID } },
    { fieldName: 'adminLogin' },
  ];
  return createMock<ArgumentsHost>({
    getType: () => 'graphql',
    getArgs: () => args,
    getArgByIndex: (index: number) => args[index],
  });
}

describe('GraphqlExceptionFilter', () => {
  let filter: GraphqlExceptionFilter;
  let errorLog: ReturnType<typeof vi.spyOn>;
  let debugLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    filter = new GraphqlExceptionFilter();
    errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    debugLog = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  it('should convert a coded exception into a GraphQL error with code and statusCode', () => {
    const result = filter.catch(
      new BusinessException(
        ErrorCode.PASSKEY_LAST_AUTH_METHOD,
        'Cannot remove your only authentication method',
      ),
      graphqlHost(),
    );

    expect(result).toBeInstanceOf(GraphQLError);
    expect(result?.message).toBe('Cannot remove your only authentication method');
    expect(result?.extensions).toEqual({ code: 'PASSKEY_LAST_AUTH_METHOD', statusCode: 400 });
  });

  it('should log client faults at debug level with the correlation id', () => {
    filter.catch(new ForbiddenException('institute scope required'), graphqlHost());

    expect(debugLog).toHaveBeenCalledWith(
      {
        correlationId: CORRELATION_ID,
        field: 'adminLogin',
        code: 'FORBIDDEN',
        reason: 'institute scope required',
      },
      'GraphQL request rejected',
    );
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('should mask unexpected errors and log them with the original error', () => {
    const boom = new Error('duplicate key value violates unique constraint "users_pkey"');

    const result = filter.catch(boom, graphqlHost());

    expect(result?.message).toBe('Internal server error');
    expect(result?.extensions).toEqual({ code: 'INTERNAL_ERROR', statusCode: 500 });
    expect(errorLog).toHaveBeenCalledWith(
      { correlationId: CORRELATION_ID, field: 'adminLogin', code: 'INTERNAL_ERROR', err: boom },
      'Unhandled GraphQL exception',
    );
  });

  it('should defer to the default HTTP handling outside GraphQL', () => {
    const httpCatch = vi
      .spyOn(BaseExceptionFilter.prototype, 'catch')
      .mockImplementation(() => undefined);
    const host = createMock<ArgumentsHost>({ getType: () => 'http' });
    const exception = new ForbiddenException();

    const result = filter.catch(exception, host);

    expect(result).toBeUndefined();
    expect(httpCatch).toHaveBeenCalledWith(exception, host);
  });
});
