import type { NotificationChannel } from '@roviq/common-types';
import type { InAppCopy, Locale, OutsideCopy } from './notification-type';
import {
  REGULAR_TYPES,
  type RegularParamsMap,
  type RegularTypeKey,
  SECRET_TYPES,
  type SecretParamsMap,
  type SecretTypeKey,
} from './registry';

export interface RegularMessage<K extends RegularTypeKey> {
  type: K;
  params: RegularParamsMap[K];
}

/** Everything collected by one digest run; `items` is never empty. */
export interface RegularDigest<K extends RegularTypeKey> {
  type: K;
  items: RegularParamsMap[K][];
}

export function composeInApp<K extends RegularTypeKey>(message: RegularMessage<K>): InAppCopy {
  return REGULAR_TYPES[message.type].inAppCopy(message.params);
}

export function composeOutside<K extends RegularTypeKey>(
  message: RegularMessage<K>,
  channel: NotificationChannel,
  locale: Locale,
): OutsideCopy {
  return REGULAR_TYPES[message.type].outsideCopy(message.params, channel, locale);
}

export function composeDigest<K extends RegularTypeKey>(
  digest: RegularDigest<K>,
  channel: NotificationChannel,
  locale: Locale,
): OutsideCopy {
  const spec = REGULAR_TYPES[digest.type].digest;
  if (!spec) {
    // A digest is only ever started for a type that declares one; reaching here is a bug.
    throw new Error(`Notification type ${digest.type} has no digest`);
  }
  return spec.summaryCopy(digest.items, channel, locale);
}

export function composeSecret<K extends SecretTypeKey>(
  type: K,
  params: SecretParamsMap[K],
  channel: NotificationChannel,
  locale: Locale,
): OutsideCopy {
  return SECRET_TYPES[type].outsideCopy(params, channel, locale);
}
