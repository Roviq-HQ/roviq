import { Inject, Injectable } from '@nestjs/common';
import {
  BusinessException,
  ErrorCode,
  MESSAGING_SENDER_STATE_MACHINE,
  MessagingSenderStatus,
  type PlatformContext,
} from '@roviq/common-types';
import { MessagingTokenCipher } from '@roviq/crypto';
import { REDIS_CLIENT, senderResetKeys } from '@roviq/redis';
import type Redis from 'ioredis';
import type {
  RegisterMessagingSenderInput,
  UpdateMessagingSenderInput,
} from './dto/messaging-sender.dto';
import { AdminMessagingRepository } from './repositories/admin-messaging.repository';
import type {
  MessagingSenderRecord,
  SmsUsageRecord,
  UpdateMessagingSenderData,
  WhatsAppUsageRecord,
} from './repositories/types';

@Injectable()
export class AdminMessagingService {
  constructor(
    private readonly repo: AdminMessagingRepository,
    private readonly cipher: MessagingTokenCipher,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  list(ctx: PlatformContext): Promise<MessagingSenderRecord[]> {
    return this.repo.list(ctx);
  }

  async register(
    ctx: PlatformContext,
    input: RegisterMessagingSenderInput,
  ): Promise<MessagingSenderRecord> {
    const tenantId = input.tenantId ?? null;
    const instituteDailyCap = input.instituteDailyCap ?? null;
    if (tenantId && instituteDailyCap !== null) refuseInstituteShare();

    const result = await this.repo.register(ctx, {
      tenantId,
      providerNumberId: input.providerNumberId,
      displayNumber: input.displayNumber,
      accessTokenEncrypted: this.cipher.encrypt(input.accessToken),
      dailyCap: input.dailyCap,
      instituteDailyCap,
    });
    switch (result.kind) {
      case 'ok':
        return result.sender;
      case 'institute_not_found':
        throw new BusinessException(ErrorCode.INSTITUTE_NOT_FOUND, 'Institute not found');
      case 'sender_exists':
        throw new BusinessException(
          ErrorCode.MESSAGING_SENDER_EXISTS,
          'A live sender already exists for this institute or platform, or the number is registered',
        );
    }
  }

  async update(
    ctx: PlatformContext,
    id: string,
    input: UpdateMessagingSenderInput,
  ): Promise<MessagingSenderRecord> {
    const existing = await this.getOrThrow(ctx, id);
    if (existing.scope === 'institute' && input.instituteDailyCap != null) {
      refuseInstituteShare();
    }
    const data: UpdateMessagingSenderData = {
      ...(input.displayNumber !== undefined && { displayNumber: input.displayNumber }),
      ...(input.dailyCap !== undefined && { dailyCap: input.dailyCap }),
      ...(input.instituteDailyCap !== undefined && { instituteDailyCap: input.instituteDailyCap }),
      ...(input.messagesPerSecond !== undefined && { messagesPerSecond: input.messagesPerSecond }),
    };
    return this.found(await this.repo.update(ctx, id, data), id);
  }

  async rotateToken(
    ctx: PlatformContext,
    id: string,
    accessToken: string,
  ): Promise<MessagingSenderRecord> {
    return this.found(await this.repo.replaceToken(ctx, id, this.cipher.encrypt(accessToken)), id);
  }

  pause(ctx: PlatformContext, id: string): Promise<MessagingSenderRecord> {
    return this.transition(ctx, id, MessagingSenderStatus.PAUSED);
  }

  /**
   * The notification service's breaker and throttle of the sender are cleared too: a sender put
   * back after a block sends at once instead of waiting out its cool-down.
   */
  async activate(ctx: PlatformContext, id: string): Promise<MessagingSenderRecord> {
    const sender = await this.transition(ctx, id, MessagingSenderStatus.ACTIVE);
    await this.redis.del(...senderResetKeys(id));
    return sender;
  }

  block(ctx: PlatformContext, id: string): Promise<MessagingSenderRecord> {
    return this.transition(ctx, id, MessagingSenderStatus.BLOCKED);
  }

  async delete(ctx: PlatformContext, id: string): Promise<void> {
    if (!(await this.repo.delete(ctx, id))) throw notFound(id);
  }

  /** `month` is YYYY-MM, already validated by the DTO. */
  whatsAppUsage(ctx: PlatformContext, month: string): Promise<WhatsAppUsageRecord[]> {
    return this.repo.whatsAppUsage(ctx, month);
  }

  /** `month` is YYYY-MM, already validated by the DTO. */
  smsUsage(ctx: PlatformContext, month: string): Promise<SmsUsageRecord[]> {
    return this.repo.smsUsage(ctx, month);
  }

  private async transition(
    ctx: PlatformContext,
    id: string,
    to: MessagingSenderStatus,
  ): Promise<MessagingSenderRecord> {
    const existing = await this.getOrThrow(ctx, id);
    MESSAGING_SENDER_STATE_MACHINE.assertTransition(existing.status, to);
    const updated = await this.repo.setStatus(ctx, id, existing.status, to);
    if (!updated) {
      throw new BusinessException(
        ErrorCode.INVALID_STATE_TRANSITION,
        `Messaging sender ${id} is no longer ${existing.status}`,
      );
    }
    return updated;
  }

  private async getOrThrow(ctx: PlatformContext, id: string): Promise<MessagingSenderRecord> {
    return this.found(await this.repo.findById(ctx, id), id);
  }

  private found(record: MessagingSenderRecord | null, id: string): MessagingSenderRecord {
    if (!record) throw notFound(id);
    return record;
  }
}

function notFound(id: string): BusinessException {
  return new BusinessException(
    ErrorCode.MESSAGING_SENDER_NOT_FOUND,
    `Messaging sender ${id} not found`,
  );
}

function refuseInstituteShare(): never {
  throw new BusinessException(
    ErrorCode.VALIDATION_FAILED,
    "instituteDailyCap applies only to the platform's sender",
  );
}
