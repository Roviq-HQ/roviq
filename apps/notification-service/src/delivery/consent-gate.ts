import { Injectable } from '@nestjs/common';
import type { NotificationChannel, NotificationTypeKey } from '@roviq/common-types';

export interface ConsentQuery {
  recipientUserId: string;
  channel: NotificationChannel;
  type: NotificationTypeKey;
  tenantId: string | null;
}

/**
 * Whether the recipient consented to this channel. The hook for ROV-269 (WhatsApp consent);
 * until then every channel is allowed.
 */
export abstract class ConsentGate {
  abstract allows(query: ConsentQuery): Promise<boolean>;
}

@Injectable()
export class AllowAllConsentGate extends ConsentGate {
  async allows(_query: ConsentQuery): Promise<boolean> {
    return true;
  }
}
