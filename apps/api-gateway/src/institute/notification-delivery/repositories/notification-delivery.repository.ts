import type { InstituteContext } from '@roviq/common-types';
import type { DeliveryLogPage, DeliveryLogQuery } from './types';

export abstract class NotificationDeliveryRepository {
  /**
   * One page of the institute's delivery log, one entry per message and recipient, newest
   * first by the entry's latest row. `afterRowId` is the `lastRowId` of the previous page's
   * last entry.
   */
  abstract listLog(
    ctx: InstituteContext,
    query: DeliveryLogQuery,
    first: number,
    afterRowId: string | null,
  ): Promise<DeliveryLogPage>;
}
