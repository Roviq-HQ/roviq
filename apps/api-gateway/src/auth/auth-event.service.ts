import { Injectable, Logger } from '@nestjs/common';
import type { AuthEventType, AuthFailureReason, AuthScope } from '@roviq/common-types';
import { AuthEventRepository } from './repositories/auth-event.repository';

interface AuthEventBase {
  userId?: string;
  authMethod?: string;
  ip?: string;
  userAgent?: string;
  deviceInfo?: string;
  metadata?: Record<string, unknown>;
}

/** A session was issued: the portal signed in to and the scope granted are the same thing. */
interface LoginSuccessEvent extends AuthEventBase {
  type: 'LOGIN_SUCCESS';
  portal: AuthScope;
  scope: AuthScope;
  tenantId?: string;
  resellerId?: string;
  /** The membership of the session that was issued, in the table `scope` names. */
  membershipId: string;
}

/** Nothing was granted, so there is no scope, tenant or reseller — only where it was tried and why it failed. */
interface RefusedAttemptEvent extends AuthEventBase {
  type: 'LOGIN_FAILED' | 'ACCOUNT_LOCKED';
  portal: AuthScope;
  failureReason: AuthFailureReason;
}

interface SessionEvent extends AuthEventBase {
  type:
    | 'LOGOUT'
    | 'TOKEN_REFRESH'
    | 'INSTITUTE_SWITCH'
    | 'IMPERSONATION_START'
    | 'IMPERSONATION_END'
    | 'ALL_SESSIONS_REVOKED'
    | 'PASSWORD_CHANGE'
    | 'PASSKEY_REGISTER';
  scope?: AuthScope;
  tenantId?: string;
  resellerId?: string;
  /** Set when the event belongs to a session (LOGOUT, TOKEN_REFRESH, INSTITUTE_SWITCH). */
  membershipId?: string;
}

export type AuthEventInput = LoginSuccessEvent | RefusedAttemptEvent | SessionEvent;
// Every stored event type has a shape above, and every shape is a stored type.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _everyEventTypeHasAShape: Exact<AuthEventInput['type'], AuthEventType> = true;
void _everyEventTypeHasAShape;

@Injectable()
export class AuthEventService {
  private readonly logger = new Logger(AuthEventService.name);

  constructor(private readonly repo: AuthEventRepository) {}

  async emit(event: AuthEventInput): Promise<void> {
    try {
      await this.repo.insert({
        userId: event.userId,
        eventType: event.type,
        portal: 'portal' in event ? event.portal : undefined,
        scope: 'scope' in event ? event.scope : undefined,
        tenantId: 'tenantId' in event ? event.tenantId : undefined,
        resellerId: 'resellerId' in event ? event.resellerId : undefined,
        membershipId: 'membershipId' in event ? event.membershipId : undefined,
        authMethod: event.authMethod,
        ipAddress: event.ip,
        userAgent: event.userAgent,
        deviceInfo: event.deviceInfo,
        failureReason: 'failureReason' in event ? event.failureReason : undefined,
        metadata: event.metadata ?? {},
      });
    } catch (error) {
      this.logger.warn(`Failed to emit auth event [${event.type}]: ${error}`);
    }
  }
}
