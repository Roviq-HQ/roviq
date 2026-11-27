import { BusinessException } from './business-exception';
import type { AuthUser } from './common-types';
import { ErrorCode } from './error-codes';

/**
 * Operations on an account itself (sessions, passkeys, password, profile, preferences,
 * notifications, devices) belong to the person. An impersonation session, of any write mode,
 * is refused. `withUser()` applies this to every statement it runs; call it first in an
 * operation that does anything else before it reaches the database.
 */
export function assertOwnSession(user: Pick<AuthUser, 'isImpersonated'>): void {
  if (user.isImpersonated) {
    throw new BusinessException(
      ErrorCode.IMPERSONATION_OWN_ACCOUNT,
      'This belongs to the account itself and is not available in an impersonation session',
    );
  }
}
