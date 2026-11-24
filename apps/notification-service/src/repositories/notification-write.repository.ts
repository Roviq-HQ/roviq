import type { DeferralRow, DeliveryRow, InAppRow } from './types';

/** The pipeline's only writes; both tables accept writes from the platform role alone. */
export abstract class NotificationWriteRepository {
  /**
   * Inserts the row unless one with the same dedupe key exists (a redelivered event). Returns
   * the row's id either way, and whether this call created it.
   */
  abstract insertInApp(row: InAppRow): Promise<{ id: string; created: boolean }>;
  abstract recordDelivery(row: DeliveryRow): Promise<void>;
  /** One DEFERRED row per flow, recipient and channel: a retried deferral adds nothing. */
  abstract recordDeferral(row: DeferralRow): Promise<void>;
}
