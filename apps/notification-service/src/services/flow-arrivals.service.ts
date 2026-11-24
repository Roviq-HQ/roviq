import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel } from '@roviq/common-types';
import { TemporalClientService } from '@roviq/temporal';
import { FLOW_ARRIVAL_SIGNAL, type FlowArrival } from '../workflows/notification-workflow.types';

/** Tells a flow's workflow that one of its messages reached its recipient (ROV-332). */
@Injectable()
export class FlowArrivals {
  private readonly logger = new Logger(FlowArrivals.name);

  constructor(private readonly temporal: TemporalClientService) {}

  async arrived(
    flowId: string | null,
    recipientUserId: string,
    via: NotificationChannel | 'IN_APP',
  ): Promise<void> {
    if (flowId === null) return;
    const arrival: FlowArrival = { recipientUserId, via };
    const signalled = await this.temporal.signal(flowId, FLOW_ARRIVAL_SIGNAL, [arrival]);
    // A report after the flow ended is normal: nothing waits for it any more.
    if (!signalled) this.logger.debug(`Flow ${flowId} has ended; arrival by ${via} not signalled`);
  }
}
