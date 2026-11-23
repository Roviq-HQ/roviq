import { isIPv4 } from 'node:net';
import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload } from '@nestjs/microservices';
import type { AuthSecurityEventType } from '@roviq/common-types';
import { JetStreamContext } from '@roviq/nats-jetstream';
import { type AuthSecurityEvent, NOTIFICATION_SUBJECTS } from '@roviq/notifications';
import type { Audience } from '../repositories/types';
import { NotificationDispatcher } from '../services/notification-dispatcher.service';
import { PLATFORM_AUDIENCE, sourceOf } from '../services/recipient-resolver.service';
import type { RegularTypeKey } from '../types/registry';

type AlertEventType = Exclude<AuthSecurityEventType, 'EMAIL_VERIFICATION' | 'IMPERSONATION_OTP'>;

const ALERT_TYPE: Record<AlertEventType, Extract<RegularTypeKey, `AUTH_${string}`>> = {
  LOGIN: 'AUTH_LOGIN',
  PASSWORD_RESET: 'AUTH_PASSWORD_RESET',
  NEW_DEVICE: 'AUTH_NEW_DEVICE',
  ACCOUNT_LOCKED: 'AUTH_ACCOUNT_LOCKED',
  SESSION_REVOKED: 'AUTH_SESSION_REVOKED',
};

const ACCOUNT_PATH: Record<Audience['scope'], string> = {
  platform: '/admin/account',
  reseller: '/reseller/account',
  institute: '/institute/account',
};

/**
 * Where the event belongs. `inApp` is false when the event names no portal: the in-app copy
 * would have nowhere to show, but delivery rows still need a scope, so they are platform rows.
 */
export function authAudience(event: AuthSecurityEvent): { audience: Audience; inApp: boolean } {
  const scope = event.scope ?? (event.tenantId ? 'institute' : null);
  if (scope === 'institute' && event.tenantId) {
    return { audience: { scope, tenantId: event.tenantId, resellerId: null }, inApp: true };
  }
  if (scope === 'reseller' && event.resellerId) {
    return { audience: { scope, tenantId: null, resellerId: event.resellerId }, inApp: true };
  }
  return { audience: PLATFORM_AUDIENCE, inApp: scope === 'platform' };
}

/** A dual-stack socket reports an IPv4 client as `::ffff:a.b.c.d`; people know the IPv4 form. */
export function displayIp(ip: string): string {
  const mapped = /^::ffff:(.+)$/i.exec(ip)?.[1];
  return mapped !== undefined && isIPv4(mapped) ? mapped : ip;
}

@Controller()
export class AuthListener {
  private readonly logger = new Logger(AuthListener.name);

  constructor(private readonly dispatcher: NotificationDispatcher) {}

  @EventPattern(NOTIFICATION_SUBJECTS.AUTH_SECURITY, {
    stream: 'NOTIFICATION',
    durable: 'notification-auth',
  })
  async handleSecurity(
    @Payload() event: AuthSecurityEvent,
    @Ctx() ctx: JetStreamContext,
  ): Promise<void> {
    const { audience, inApp } = authAudience(event);
    const { eventType, metadata } = event;

    if (eventType === 'EMAIL_VERIFICATION') {
      // SF-045: only to the address the event names.
      if (!metadata.otp || !metadata.recipientEmail) {
        this.logger.error(
          `EMAIL_VERIFICATION for user "${event.userId}" lacks a code or an address`,
        );
        return;
      }
      await this.dispatcher.dispatchSecret({
        message: { type: 'EMAIL_VERIFICATION', params: { code: metadata.otp } },
        audience,
        recipientUserId: event.userId,
        addresses: { EMAIL: metadata.recipientEmail },
      });
      return;
    }

    if (eventType === 'IMPERSONATION_OTP') {
      if (!metadata.otp) {
        this.logger.error(`IMPERSONATION_OTP for user "${event.userId}" lacks a code`);
        return;
      }
      await this.dispatcher.dispatchSecret({
        message: { type: 'IMPERSONATION_OTP', params: { otp: metadata.otp } },
        audience,
        recipientUserId: event.userId,
        addresses: { SMS: metadata.recipientPhone ?? null },
      });
      return;
    }

    const ip = typeof metadata.ip === 'string' ? displayIp(metadata.ip) : null;
    await this.dispatcher.dispatch({
      message: {
        type: ALERT_TYPE[eventType],
        params: { ip, at: new Date().toISOString(), accountPath: ACCOUNT_PATH[audience.scope] },
      },
      audience,
      recipients: [{ userId: event.userId, membershipId: null }],
      recipientsRef: null,
      source: sourceOf(ctx),
      inApp,
    });
  }
}
