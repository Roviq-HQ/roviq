import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { BusinessException, ErrorCode, type SignedInUser } from '@roviq/common-types';
import { EventBusService } from '@roviq/event-bus';
import type { AuthSecurityEvent } from '@roviq/notifications';
import { NOTIFICATION_SUBJECTS } from '@roviq/notifications';
import { REDIS_CLIENT } from '@roviq/redis';
import type Redis from 'ioredis';
import { REDIS_KEYS } from './redis-keys';
import { UserRepository } from './repositories/user.repository';

export const EMAIL_VERIFICATION_CODE_TTL_SECONDS = 10 * 60;
export const EMAIL_VERIFICATION_RESEND_AFTER_SECONDS = 60;
export const EMAIL_VERIFICATION_MAX_ATTEMPTS = 5;
/** Codes one user may be sent in a day. With 5 guesses each, that bounds guessing to 25 a day. */
export const EMAIL_VERIFICATION_MAX_CODES_PER_DAY = 5;
const DAY_SECONDS = 24 * 60 * 60;

const hashCode = (code: string) => createHash('sha256').update(code).digest();

function keysOf(userId: string): { code: string; attempts: string; sent: string } {
  const code = `${REDIS_KEYS.EMAIL_VERIFICATION}${userId}`;
  return { code, attempts: `${code}:attempts`, sent: `${code}:sent` };
}

export interface EmailVerificationState {
  email: string;
  isVerified: boolean;
}

/**
 * Proves that a user reads the mailbox of their account's email (SF-045). The code goes to
 * that address only: never by SMS and never into the in-app feed, because whoever created the
 * account may hold its password and the phone number on it.
 */
@Injectable()
export class EmailVerificationService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly users: UserRepository,
    private readonly eventBus: EventBusService,
  ) {}

  async state(user: SignedInUser): Promise<EmailVerificationState> {
    const account = await this.requireUser(user);
    return { email: account.email, isVerified: account.emailVerifiedAt !== null };
  }

  /** Sends a fresh code, replacing any earlier one. No-op for a verified address. */
  async request(user: SignedInUser): Promise<void> {
    const userId = user.userId;
    const account = await this.requireUser(user);
    if (account.emailVerifiedAt) return;

    const keys = keysOf(userId);
    const remaining = await this.redis.ttl(keys.code);
    if (remaining > EMAIL_VERIFICATION_CODE_TTL_SECONDS - EMAIL_VERIFICATION_RESEND_AFTER_SECONDS) {
      throw new BusinessException(
        ErrorCode.EMAIL_VERIFICATION_TOO_SOON,
        'A code was sent a moment ago',
      );
    }

    // A fresh code resets the guess counter, so the number of codes is capped too: otherwise
    // whoever holds the account without the mailbox could guess without limit.
    const sentToday = await this.redis.incr(keys.sent);
    if (sentToday === 1) await this.redis.expire(keys.sent, DAY_SECONDS);
    if (sentToday > EMAIL_VERIFICATION_MAX_CODES_PER_DAY) {
      throw new BusinessException(
        ErrorCode.EMAIL_VERIFICATION_LIMIT_REACHED,
        'No more codes can be sent today',
      );
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.redis.del(keys.attempts);
    await this.redis.set(
      keys.code,
      hashCode(code).toString('hex'),
      'EX',
      EMAIL_VERIFICATION_CODE_TTL_SECONDS,
    );

    const event: AuthSecurityEvent = {
      tenantId: null,
      userId,
      eventType: 'EMAIL_VERIFICATION',
      metadata: { otp: code, recipientEmail: account.email },
      // The address belongs to the account, not to one portal.
      scope: 'platform',
      resellerId: null,
    };
    this.eventBus.emit(NOTIFICATION_SUBJECTS.AUTH_SECURITY, event);
  }

  /** Marks the address verified. One error for wrong, expired and exhausted codes. */
  async verify(user: SignedInUser, code: string): Promise<void> {
    const userId = user.userId;
    const keys = keysOf(userId);
    const invalid = () =>
      new BusinessException(
        ErrorCode.EMAIL_VERIFICATION_CODE_INVALID,
        'The code is wrong or has expired',
      );

    // Counted before the comparison, so parallel guesses cannot exceed the limit.
    const attempts = await this.redis.incr(keys.attempts);
    if (attempts === 1) {
      await this.redis.expire(keys.attempts, EMAIL_VERIFICATION_CODE_TTL_SECONDS);
    }
    const codeHash = await this.redis.get(keys.code);
    if (!codeHash || attempts > EMAIL_VERIFICATION_MAX_ATTEMPTS) {
      await this.redis.del(keys.code, keys.attempts);
      throw invalid();
    }
    if (!timingSafeEqual(Buffer.from(codeHash, 'hex'), hashCode(code))) throw invalid();

    await this.users.markEmailVerified(user);
    await this.redis.del(keys.code, keys.attempts);
  }

  /** Drops a pending code, so a new one can be requested at once. The daily count stays. */
  async clearPending(userId: string): Promise<void> {
    const keys = keysOf(userId);
    await this.redis.del(keys.code, keys.attempts);
  }

  private async requireUser(user: SignedInUser) {
    const account = await this.users.findOwn(user);
    if (!account) throw new BusinessException(ErrorCode.UNAUTHENTICATED, 'Account not found');
    return account;
  }
}
