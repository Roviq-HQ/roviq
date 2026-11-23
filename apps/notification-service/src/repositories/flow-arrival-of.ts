import type { NotificationChannel } from '@roviq/common-types';
import type { FlowArrivalRecord } from './types';

/** The arrival a newly appended report row proves: a DELIVERED row of a flow. */
export function arrivalOf(
  sent: { flowId: string | null; recipientUserId: string; channel: NotificationChannel },
  status: 'DELIVERED' | 'FAILED',
): FlowArrivalRecord | null {
  if (status !== 'DELIVERED' || sent.flowId === null) return null;
  return { flowId: sent.flowId, recipientUserId: sent.recipientUserId, channel: sent.channel };
}
