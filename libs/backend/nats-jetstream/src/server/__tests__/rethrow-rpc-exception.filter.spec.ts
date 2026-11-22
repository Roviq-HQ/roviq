import type { ArgumentsHost } from '@nestjs/common';
import { RpcExceptionsHandler } from '@nestjs/microservices/exceptions/rpc-exceptions-handler';
import { createMock } from '@roviq/testing';
import { lastValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { deadLetterErrorText } from '../error-text';
import { runHandlerChain } from '../handler-chain';
import { RethrowRpcExceptionFilter } from '../rethrow-rpc-exception.filter';

function handlerWithFilter(filter: RethrowRpcExceptionFilter | null) {
  const handler = new RpcExceptionsHandler();
  if (filter)
    handler.setCustomFilters([{ exceptionMetatypes: [], func: filter.catch.bind(filter) }]);
  return handler;
}

describe('RethrowRpcExceptionFilter', () => {
  it('should emit the original error object', async () => {
    const original = new Error('duplicate key', { cause: new Error('inner') });

    await expect(lastValueFrom(new RethrowRpcExceptionFilter().catch(original))).rejects.toBe(
      original,
    );
  });

  it("should replace Nest's generic text so the chain fails with the real error", async () => {
    const original = new SyntaxError('payload shape changed');
    const host = createMock<ArgumentsHost>();
    const withFilter = handlerWithFilter(new RethrowRpcExceptionFilter());
    const withoutFilter = handlerWithFilter(null);

    const filtered = runHandlerChain([() => withFilter.handle(original, host)], {}, {});
    const unfiltered = runHandlerChain([() => withoutFilter.handle(original, host)], {}, {});

    await expect(filtered).rejects.toBe(original);
    await expect(filtered.catch(deadLetterErrorText)).resolves.toBe(
      'SyntaxError: payload shape changed',
    );
    await expect(unfiltered.catch(deadLetterErrorText)).resolves.toBe(
      'Error: Internal server error',
    );
  });
});
