import { assertTenantContext } from '@roviq/auth-backend';
import {
  type AuthUser,
  BusinessException,
  ErrorCode,
  type InstituteContext,
  type PlatformContext,
  type ResellerContext,
} from '@roviq/common-types';

/** Whose notifications a request may see. Built only from the verified token. */
export type NotificationViewer =
  | {
      scope: 'institute';
      ctx: InstituteContext;
      userId: string;
      tenantId: string;
      membershipId: string;
    }
  | { scope: 'reseller'; ctx: ResellerContext; userId: string; resellerId: string }
  | { scope: 'platform'; ctx: PlatformContext; userId: string };

export function notificationViewerOf(user: AuthUser): NotificationViewer {
  switch (user.scope) {
    case 'institute':
      assertTenantContext(user);
      return {
        scope: 'institute',
        ctx: user,
        userId: user.userId,
        tenantId: user.tenantId,
        membershipId: user.membershipId,
      };
    case 'reseller':
      if (!user.resellerId) {
        throw new BusinessException(ErrorCode.FORBIDDEN, 'Reseller scope required');
      }
      return { scope: 'reseller', ctx: user, userId: user.userId, resellerId: user.resellerId };
    case 'platform':
      return { scope: 'platform', ctx: user, userId: user.userId };
  }
}

/**
 * Support staff acting as someone may read that person's inbox but not change it, and
 * must never point that person's push messages at a device of their own.
 */
export function assertOwnSession(user: AuthUser): void {
  if (user.isImpersonated) {
    throw new BusinessException(
      ErrorCode.FORBIDDEN,
      'Notifications and devices cannot be changed while impersonating',
    );
  }
}

export const DEVICE_TOKEN_MAX_LENGTH = 4096;

export function assertValidDeviceToken(token: string): void {
  if (token.trim().length === 0 || token.length > DEVICE_TOKEN_MAX_LENGTH) {
    throw new BusinessException(ErrorCode.VALIDATION_FAILED, 'Invalid device token');
  }
}
