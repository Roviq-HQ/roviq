import { Catch, type RpcExceptionFilter } from '@nestjs/common';
import { type Observable, throwError } from 'rxjs';

/**
 * Nest's default RPC filter replaces an unknown error with `{ status, message: 'Internal server
 * error' }`. Passing the original through lets the server nak, log and dead-letter the real error.
 */
@Catch()
export class RethrowRpcExceptionFilter implements RpcExceptionFilter<unknown> {
  catch(exception: unknown): Observable<never> {
    return throwError(() => exception);
  }
}
