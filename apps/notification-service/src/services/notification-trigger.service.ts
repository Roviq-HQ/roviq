import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Novu } from '@novu/api';
import type { TriggerPayload } from '@roviq/notifications';

@Injectable()
export class NotificationTriggerService {
  private readonly logger = new Logger(NotificationTriggerService.name);
  private readonly novu: Novu;

  constructor(config: ConfigService) {
    this.novu = new Novu({ secretKey: config.getOrThrow<string>('NOVU_SECRET_KEY') });
  }

  async trigger(payload: TriggerPayload): Promise<void> {
    this.logger.log(
      `Triggering workflow "${payload.workflowId}" for subscriber "${payload.to.subscriberId}"`,
    );

    await this.novu.trigger({
      workflowId: payload.workflowId,
      to: {
        subscriberId: payload.to.subscriberId,
        email: payload.to.email,
        phone: payload.to.phone,
      },
      payload: payload.payload,
      context: payload.tenantId ? { tenant: { id: payload.tenantId } } : undefined,
    });
  }
}
