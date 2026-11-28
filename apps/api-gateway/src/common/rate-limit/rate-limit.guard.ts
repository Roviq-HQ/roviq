import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { JwtService } from '@nestjs/jwt';
import { BusinessException, ErrorCode } from '@roviq/common-types';
import { readRequestTokenClaims } from '../../auth/middleware/request-token-claims';
import { clientAddressKey } from './client-address-key';
import { RATE_LIMITS, type RateLimitBucket, type RateLimits } from './rate-limit.buckets';
import { RATE_LIMIT_KEY } from './rate-limit.decorator';
import { RateLimitStore, type RateLimitSubject } from './rate-limit.store';

const WEBHOOK_PATH = '/api/webhooks/';

interface RequestLike {
  ip?: string;
  originalUrl?: string;
}

/**
 * Counts every handler call and refuses the ones over a limit with `TOO_MANY_REQUESTS`.
 *
 * - Each GraphQL root field is one handler call, so a request with ten aliased fields
 *   counts ten.
 * - A subscription counts once, when it starts, against its user; the events it then
 *   receives count nothing. A WebSocket connection has no client address of its own.
 * - Handlers of NATS events are not requests and are not counted.
 * - When Redis cannot be reached the request goes through: the limit protects the service,
 *   and must not be what takes it down.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly store: RateLimitStore,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @Inject(RATE_LIMITS) private readonly limits: RateLimits,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType<string>() === 'rpc') return true;
    const marked = this.reflector.getAllAndOverride<RateLimitBucket | false | undefined>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (marked === false) return true;

    const request = this.requestOf(context);
    const subjects = this.subjectsOf(context, request);
    // Express matches routes without regard to case, so the path is compared the same way.
    const isWebhook = request?.originalUrl?.toLowerCase().startsWith(WEBHOOK_PATH) ?? false;
    const named = marked ?? (isWebhook ? 'webhook' : null);

    for (const subject of subjects) {
      await this.count(subject.kind === 'address' ? 'general' : 'user', subject);
      if (named) await this.count(named, subject);
    }
    return true;
  }

  private requestOf(context: ExecutionContext): RequestLike | undefined {
    if (context.getType<string>() === 'graphql') {
      return GqlExecutionContext.create(context).getContext<{ req?: RequestLike }>().req;
    }
    return context.switchToHttp().getRequest<RequestLike | undefined>();
  }

  private subjectsOf(
    context: ExecutionContext,
    request: RequestLike | undefined,
  ): RateLimitSubject[] {
    const subjects: RateLimitSubject[] = [];
    if (request?.ip) subjects.push({ kind: 'address', id: clientAddressKey(request.ip) });
    const claims = readRequestTokenClaims(
      context,
      this.jwtService,
      this.config.getOrThrow<string>('JWT_SECRET'),
    );
    if (claims?.sub) subjects.push({ kind: 'user', id: claims.sub });
    return subjects;
  }

  private async count(bucket: RateLimitBucket, subject: RateLimitSubject): Promise<void> {
    const { limit, windowSeconds } = this.limits[bucket];
    let result: { count: number; retryAfterSeconds: number };
    try {
      result = await this.store.hit(bucket, subject, windowSeconds);
    } catch (err) {
      this.logger.warn({ err }, 'Request limit not counted: the counter store failed');
      return;
    }
    if (result.count > limit) {
      throw new BusinessException(
        ErrorCode.TOO_MANY_REQUESTS,
        `Too many requests. Try again in ${result.retryAfterSeconds} seconds.`,
      );
    }
  }
}
