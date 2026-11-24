'use client';

import type { NotificationChannel, NotificationDeliveryState } from '@roviq/graphql/generated';
import { useTranslations } from 'next-intl';
import * as React from 'react';

export interface DeliveryCopy {
  typeName: (type: string) => string;
  channelName: (channel: NotificationChannel) => string;
  stateName: (state: NotificationDeliveryState) => string;
  /** A stored skip reason or provider error code in plain words; unknown codes get the `other` line. */
  reasonText: (code: string) => string;
  relationshipName: (relationship: string | null) => string | null;
}

export function useDeliveryCopy(): DeliveryCopy {
  const t = useTranslations('notificationDelivery');
  const tGuardians = useTranslations('guardians');

  return React.useMemo(
    () => ({
      typeName: (type) => (t.has(`types.${type}`) ? t(`types.${type}`) : t('types.unknown')),
      channelName: (channel) => t(`channels.${channel}`),
      stateName: (state) => t(`states.${state}`),
      reasonText: (code) => (t.has(`reasons.${code}`) ? t(`reasons.${code}`) : t('reasons.other')),
      relationshipName: (relationship) => {
        if (!relationship) return null;
        const key = `detail.children.relationships.${relationship}`;
        return tGuardians.has(key) ? tGuardians(key) : null;
      },
    }),
    [t, tGuardians],
  );
}
