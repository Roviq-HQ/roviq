import { NOTIFICATION_TYPE_VALUES } from '@roviq/common-types';
import type {
  NotificationChannel,
  NotificationDeliveryLogFilterInput,
  NotificationDeliveryState,
  NotificationModule,
} from '@roviq/graphql/generated';
import {
  parseAsBoolean,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
  type Values,
} from 'nuqs';

export const DELIVERY_MODULES = [
  'ATTENDANCE',
  'FEE',
  'LEAVE',
  'APPROVAL',
  'ACCOUNT_SECURITY',
  'ACCOUNT',
  'BILLING',
] as const satisfies readonly NotificationModule[];

/** Column order: the app first, then the paid channels, then email. */
export const DELIVERY_CHANNELS = [
  'PUSH',
  'WHATSAPP',
  'SMS',
  'EMAIL',
] as const satisfies readonly NotificationChannel[];

export const DELIVERY_STATES = [
  'READ',
  'DELIVERED',
  'SENT',
  'FAILED',
  'SKIPPED',
  'WAITING',
] as const satisfies readonly NotificationDeliveryState[];

export const deliveryFilterParsers = {
  module: parseAsStringLiteral(DELIVERY_MODULES),
  type: parseAsStringLiteral(NOTIFICATION_TYPE_VALUES),
  channel: parseAsStringLiteral(DELIVERY_CHANNELS),
  state: parseAsStringLiteral(DELIVERY_STATES),
  from: parseAsString,
  to: parseAsString,
  critical: parseAsBoolean,
  notDelivered: parseAsBoolean,
  studentId: parseAsString,
  sessionId: parseAsString,
  recipientUserId: parseAsString,
};

export type DeliveryFilters = Values<typeof deliveryFilterParsers>;

export const CLEARED_DELIVERY_FILTERS = Object.fromEntries(
  Object.keys(deliveryFilterParsers).map((key) => [key, null]),
) as { [K in keyof DeliveryFilters]: null };

export function useDeliveryFilters() {
  return useQueryStates(deliveryFilterParsers);
}

export function hasActiveDeliveryFilters(filters: DeliveryFilters): boolean {
  return Object.values(filters).some((value) => value !== null && value !== false);
}

export function buildDeliveryFilter(filters: DeliveryFilters): NotificationDeliveryLogFilterInput {
  const filter: NotificationDeliveryLogFilterInput = {};
  if (filters.module) filter.module = filters.module;
  if (filters.type) filter.type = filters.type;
  if (filters.channel) filter.channel = filters.channel;
  if (filters.state) filter.state = filters.state;
  if (filters.studentId) filter.studentId = filters.studentId;
  if (filters.sessionId) filter.sessionId = filters.sessionId;
  if (filters.recipientUserId) filter.recipientUserId = filters.recipientUserId;
  const from = filters.from ? localDayBoundary(filters.from, 'start') : null;
  if (from) filter.from = from;
  const to = filters.to ? localDayBoundary(filters.to, 'end') : null;
  if (to) filter.to = to;
  if (filters.critical) filter.criticalOnly = true;
  if (filters.notDelivered) filter.notDeliveredOnly = true;
  return filter;
}

// A `YYYY-MM-DD` picked by the user means that day in their own time zone, not UTC.
function localDayBoundary(isoDate: string, edge: 'start' | 'end'): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const [, y, m, d] = match;
  const date =
    edge === 'start'
      ? new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0)
      : new Date(Number(y), Number(m) - 1, Number(d), 23, 59, 59, 999);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
