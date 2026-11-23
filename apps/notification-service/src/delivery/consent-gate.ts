import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel, NotificationTypeKey } from '@roviq/common-types';
import { ConsentReadRepository } from '../repositories/consent-read.repository';

export interface ConsentQuery {
  recipientUserId: string;
  channel: NotificationChannel;
  type: NotificationTypeKey;
  tenantId: string | null;
  /** Membership id of the student the message is about; null when it is about none. */
  studentMembershipId: string | null;
}

/** Whether the recipient consented to being reached on this channel. */
export abstract class ConsentGate {
  abstract allows(query: ConsentQuery): Promise<boolean>;
}

/** `consent_records.purpose` that covers WhatsApp messages (DPDP purpose-specific consent). */
export const WHATSAPP_CONSENT_PURPOSE = 'whatsapp_communication';

/**
 * A guardian gets WhatsApp only while their latest `whatsapp_communication` consent is granted
 * (ROV-269). Read on every send, with no cache, so a withdrawal applies to the next message.
 * Other channels, and recipients who are not guardians of the institute, are not gated here.
 */
@Injectable()
export class GuardianConsentGate extends ConsentGate {
  private readonly logger = new Logger(GuardianConsentGate.name);

  constructor(private readonly consents: ConsentReadRepository) {
    super();
  }

  async allows(query: ConsentQuery): Promise<boolean> {
    if (query.channel !== 'WHATSAPP' || query.tenantId === null) return true;

    const state = await this.consents.guardianConsent({
      tenantId: query.tenantId,
      recipientUserId: query.recipientUserId,
      studentMembershipId: query.studentMembershipId,
      purpose: WHATSAPP_CONSENT_PURPOSE,
    });
    if (state === 'granted' || state === 'not_guardian') return true;

    // Ids only: never a phone number.
    this.logger.warn(
      {
        'notification.skip': true,
        reason: state === 'withdrawn' ? 'consent_withdrawn' : 'consent_missing',
        channel: query.channel,
        type: query.type,
        tenantId: query.tenantId,
        recipientUserId: query.recipientUserId,
        studentMembershipId: query.studentMembershipId,
      },
      'WhatsApp skipped: no active guardian consent',
    );
    return false;
  }
}
