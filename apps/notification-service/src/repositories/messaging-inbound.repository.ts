import type { InboundPerson, ReceiptInput, ReceiptResult } from './types';

export abstract class MessagingInboundRepository {
  /**
   * Appends a DELIVERED or FAILED row copied from the SENT row of the same sender and message.
   * The flow id is copied too. `duplicate`: the event was handled before. `unknown_message`:
   * this sender sent no such message; nothing is written.
   */
  abstract recordReceipt(input: ReceiptInput): Promise<ReceiptResult>;

  /**
   * Appends the person's request to stop or to start again. `changed` is false for a repeated
   * event, and when the request changes nothing (STOP from a person already stopped, START
   * from one who never stopped). `phone` is the number to confirm to, looked up from earlier
   * events when the event came without one.
   */
  abstract recordPreference(
    senderId: string,
    eventId: string,
    person: InboundPerson,
    action: 'STOP' | 'START',
  ): Promise<{ changed: boolean; phone: string | null }>;

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
