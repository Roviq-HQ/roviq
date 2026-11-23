import type { InboundPerson, ReceiptInput } from './types';

export abstract class MessagingInboundRepository {
  /**
   * Appends a DELIVERED or FAILED row copied from the SENT row of the same sender and message.
   * `duplicate`: the event was handled before. `unknown_message`: this sender sent no such
   * message; nothing is written.
   */
  abstract recordReceipt(
    input: ReceiptInput,
  ): Promise<'recorded' | 'duplicate' | 'unknown_message'>;

  /**
   * Appends an opt-out for the person. `created` is false for a repeated event or a person who
   * already opted out. `phone` is the number to confirm to, looked up from earlier events when
   * the event came without one.
   */
  abstract recordOptOut(
    senderId: string,
    eventId: string,
    person: InboundPerson,
  ): Promise<{ created: boolean; phone: string | null }>;

  /**
   * Records an inbound message. `reply` is true for the first one of the person on `day`,
   * unless they opted out or the event was handled before.
   */
  abstract recordMessage(
    senderId: string,
    eventId: string,
    person: InboundPerson,
    day: string,
  ): Promise<{ reply: boolean }>;
}
