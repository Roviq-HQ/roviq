import type { NotificationTypeKey } from '@roviq/common-types';
import type { ApprovalRequestedParams, ApprovalResolvedParams } from './approval.types';
import { approvalRequestedType, approvalResolvedType } from './approval.types';
import type { AttendanceAbsentParams } from './attendance-absent.type';
import { attendanceAbsentType } from './attendance-absent.type';
import type { AuthSecurityParams } from './auth-security.types';
import {
  authAccountLockedType,
  authLoginType,
  authNewDeviceType,
  authPasswordResetType,
  authSessionRevokedType,
} from './auth-security.types';
import type { BillingEventParams } from './billing-event.type';
import { billingEventType } from './billing-event.type';
import type { DeliveryCanaryParams } from './delivery-canary.type';
import { deliveryCanaryType } from './delivery-canary.type';
import type { FeeOverdueParams, FeeReminderParams } from './fee.types';
import { feeOverdueType, feeReminderType } from './fee.types';
import type { LeaveDecidedParams } from './leave-decided.type';
import { leaveDecidedType } from './leave-decided.type';
import type {
  PlatformNotificationType,
  RegularNotificationType,
  SecretNotificationType,
} from './notification-type';
import type {
  EmailVerificationParams,
  ImpersonationOtpParams,
  UserWelcomeParams,
} from './secret.types';
import { emailVerificationType, impersonationOtpType, userWelcomeType } from './secret.types';

/** Params each type's copy is composed from. Secret params never leave the listener call. */
export interface SecretParamsMap {
  EMAIL_VERIFICATION: EmailVerificationParams;
  IMPERSONATION_OTP: ImpersonationOtpParams;
  USER_WELCOME: UserWelcomeParams;
}

export interface RegularParamsMap {
  ATTENDANCE_ABSENT: AttendanceAbsentParams;
  FEE_OVERDUE: FeeOverdueParams;
  FEE_REMINDER: FeeReminderParams;
  LEAVE_DECIDED: LeaveDecidedParams;
  APPROVAL_REQUESTED: ApprovalRequestedParams;
  APPROVAL_RESOLVED: ApprovalResolvedParams;
  AUTH_LOGIN: AuthSecurityParams;
  AUTH_PASSWORD_RESET: AuthSecurityParams;
  AUTH_NEW_DEVICE: AuthSecurityParams;
  AUTH_ACCOUNT_LOCKED: AuthSecurityParams;
  AUTH_SESSION_REVOKED: AuthSecurityParams;
  BILLING_EVENT: BillingEventParams;
}

export interface PlatformParamsMap {
  DELIVERY_CANARY: DeliveryCanaryParams;
}

export type SecretTypeKey = keyof SecretParamsMap;
export type RegularTypeKey = keyof RegularParamsMap;
export type PlatformTypeKey = keyof PlatformParamsMap;

type Covered = SecretTypeKey | RegularTypeKey | PlatformTypeKey;
type MustBeEmpty<T extends never> = T;
/** Fails to compile unless the three maps cover NOTIFICATION_TYPE_VALUES exactly. */
export type RegistryCoverage = [
  MustBeEmpty<Exclude<NotificationTypeKey, Covered>>,
  MustBeEmpty<Exclude<Covered, NotificationTypeKey>>,
];

export const SECRET_TYPES: { [K in SecretTypeKey]: SecretNotificationType<SecretParamsMap[K]> } = {
  EMAIL_VERIFICATION: emailVerificationType,
  IMPERSONATION_OTP: impersonationOtpType,
  USER_WELCOME: userWelcomeType,
};

export const PLATFORM_TYPES: {
  [K in PlatformTypeKey]: PlatformNotificationType<PlatformParamsMap[K]>;
} = {
  DELIVERY_CANARY: deliveryCanaryType,
};

export const REGULAR_TYPES: {
  [K in RegularTypeKey]: RegularNotificationType<RegularParamsMap[K]>;
} = {
  ATTENDANCE_ABSENT: attendanceAbsentType,
  FEE_OVERDUE: feeOverdueType,
  FEE_REMINDER: feeReminderType,
  LEAVE_DECIDED: leaveDecidedType,
  APPROVAL_REQUESTED: approvalRequestedType,
  APPROVAL_RESOLVED: approvalResolvedType,
  AUTH_LOGIN: authLoginType,
  AUTH_PASSWORD_RESET: authPasswordResetType,
  AUTH_NEW_DEVICE: authNewDeviceType,
  AUTH_ACCOUNT_LOCKED: authAccountLockedType,
  AUTH_SESSION_REVOKED: authSessionRevokedType,
  BILLING_EVENT: billingEventType,
};

/** A regular type's key with its params; the correlated shape every Temporal input carries. */
export type RegularPayload = {
  [K in RegularTypeKey]: { type: K; params: RegularParamsMap[K] };
}[RegularTypeKey];

export type SecretPayload = {
  [K in SecretTypeKey]: { type: K; params: SecretParamsMap[K] };
}[SecretTypeKey];
