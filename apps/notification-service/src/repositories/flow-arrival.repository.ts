import type { FlowArrivalRecord } from './types';

/** Reads and writes behind arrival events from the gateway (ROV-332). */
export abstract class FlowArrivalRepository {
  /**
   * The flow id of the in-app notification with this id and recipient; `not_found` when no
   * such notification belongs to that recipient.
   */
  abstract findInAppFlow(
    notificationId: string,
    recipientUserId: string,
  ): Promise<{ kind: 'found'; flowId: string | null } | { kind: 'not_found' }>;

  /**
   * Appends one DELIVERED push row copied from the latest SENT push row of this notification and
   * recipient. `no_push`: none was sent; `duplicate`: a DELIVERED push row exists already.
   */
  abstract acknowledgePush(
    notificationId: string,
    recipientUserId: string,
  ): Promise<
    | { kind: 'recorded'; arrival: FlowArrivalRecord | null }
    | { kind: 'no_push' }
    | { kind: 'duplicate' }
  >;
}
