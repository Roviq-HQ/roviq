import { Inject, Injectable } from '@nestjs/common';
import { BusinessException, ErrorCode, isPlaceholderEmail } from '@roviq/common-types';
import { REDIS_CLIENT } from '@roviq/redis';
import type Redis from 'ioredis';
import { IdentityService } from '../../auth/identity.service';
import { REDIS_KEYS } from '../../auth/redis-keys';

export const SIGN_IN_RESEND_MIN_INTERVAL_SECONDS = 60;
export const SIGN_IN_RESEND_MAX_PER_DAY = 5;
const DAY_SECONDS = 24 * 60 * 60;

type Phone = { countryCode: string; number: string };

/** A staff member or guardian of the caller's institute, read through its own profile row. */
export interface SignInTarget {
  userId: string;
  username: string;
  /** The account's stored email, placeholder included; filtered here. */
  email: string;
  phone: Phone | null;
  firstName: string | null;
  lastName: string | null;
  mustChangePassword: boolean;
}

/** The addresses a welcome may go to: a placeholder email is no address. */
export function welcomeAddresses(
  email: string | null | undefined,
  phone: Phone | null | undefined,
) {
  const realEmail = email && !isPlaceholderEmail(email) ? email : null;
  return { email: realEmail, phone: phone ?? null };
}

/**
 * Sends a staff member's or guardian's username and temporary password (ROV-315). The password
 * is only ever handed to `sendWelcomeNotification`, never returned or logged.
 */
@Injectable()
export class SignInDetailsService {
  constructor(
    private readonly identity: IdentityService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Welcome for an account created moments ago; nothing when it has no real address. */
  sendOnCreate(params: {
    tenantId: string;
    userId: string;
    username: string;
    email: string | null | undefined;
    phone: Phone | null | undefined;
    firstName: string | null;
    lastName: string | null;
    tempPassword: string;
  }): boolean {
    const to = welcomeAddresses(params.email, params.phone);
    if (!to.email && !to.phone) return false;
    this.identity.sendWelcomeNotification({
      userId: params.userId,
      username: params.username,
      email: to.email,
      phone: to.phone ?? undefined,
      firstName: params.firstName ?? undefined,
      lastName: params.lastName ?? undefined,
      tempPassword: params.tempPassword,
      scope: 'institute',
      tenantId: params.tenantId,
    });
    return true;
  }

  /**
   * New temporary password, sent again. Refused before any write when the person has no address,
   * has already signed in, or was sent details too recently.
   */
  async resend(tenantId: string, target: SignInTarget, actorId: string): Promise<void> {
    const to = welcomeAddresses(target.email, target.phone);
    if (!to.email && !to.phone) {
      throw new BusinessException(
        ErrorCode.SIGN_IN_CONTACT_MISSING,
        'This person has no email or phone to send sign-in details to',
      );
    }
    if (!target.mustChangePassword) throw alreadyCompleted();
    await this.takeResendSlot(target.userId);

    const tempPassword = await this.identity.reissueTempPassword(target.userId, actorId);
    // The password was changed between the read and the write.
    if (tempPassword === null) throw alreadyCompleted();

    this.identity.sendWelcomeNotification({
      userId: target.userId,
      username: target.username,
      email: to.email,
      phone: to.phone ?? undefined,
      firstName: target.firstName ?? undefined,
      lastName: target.lastName ?? undefined,
      tempPassword,
      scope: 'institute',
      tenantId,
    });
  }

  /** One resend a minute and five a day per person, whoever asks. */
  private async takeResendSlot(userId: string): Promise<void> {
    const key = `${REDIS_KEYS.SIGN_IN_RESEND}${userId}`;
    const free = await this.redis.set(
      `${key}:minute`,
      '1',
      'EX',
      SIGN_IN_RESEND_MIN_INTERVAL_SECONDS,
      'NX',
    );
    if (free !== 'OK') {
      throw new BusinessException(
        ErrorCode.TOO_MANY_REQUESTS,
        'Sign-in details were sent moments ago',
      );
    }
    const sentToday = await this.redis.incr(`${key}:day`);
    if (sentToday === 1) await this.redis.expire(`${key}:day`, DAY_SECONDS);
    if (sentToday > SIGN_IN_RESEND_MAX_PER_DAY) {
      throw new BusinessException(
        ErrorCode.TOO_MANY_REQUESTS,
        'No more sign-in details can be sent to this person today',
      );
    }
  }
}

function alreadyCompleted() {
  return new BusinessException(
    ErrorCode.SIGN_IN_ALREADY_COMPLETED,
    'This person has already signed in and set a password',
  );
}
