import type { ProviderReceipt, ReceiptResult } from './types';

export abstract class DeliveryReceiptRepository {
  /**
   * Appends a DELIVERED or FAILED row copied from the SENT row with the same provider and
   * provider message id, so the institute and recipient come from our own row and never from
   * the report, flow id included. `duplicate`: this report was recorded before.
   * `unknown_message`: no such message was sent; nothing is written.
   */
  abstract record(receipt: ProviderReceipt): Promise<ReceiptResult>;
}
