import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Novu } from '@novu/api';
import { createNovuClient, type TriggerPayload } from '@roviq/notifications';
import { createCircuitBreaker } from '@roviq/resilience';
import type CircuitBreaker from 'opossum';

@Injectable()
export class NotificationTriggerService {
  private readonly logger = new Logger(NotificationTriggerService.name);
  private readonly novu: Novu;
  private readonly breaker: CircuitBreaker<[TriggerPayload], void>;

  constructor(config: ConfigService) {
    this.novu = createNovuClient(config);
    this.breaker = createCircuitBreaker((payload: TriggerPayload) => this.callNovu(payload), {
      name: 'novu-trigger',
      timeout: 10_000,
      errorThresholdPercentage: 50,
      resetTimeout: 30_000,
      // Throw so a circuit-open propagates as an error: the JetStream consumer
      // naks → retries → eventual DLQ. A silent fallback would drop the message.
      fallback: () => {
        throw new Error('novu-trigger circuit open');
      },
    });
  }

  async trigger(payload: TriggerPayload): Promise<void> {
    await this.breaker.fire(payload);
  }

  private async callNovu(payload: TriggerPayload): Promise<void> {
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
