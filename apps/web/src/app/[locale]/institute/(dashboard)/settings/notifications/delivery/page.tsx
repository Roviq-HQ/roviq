'use client';

import { Can } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useTranslations } from 'next-intl';
import { DeliveryLog } from './delivery-log';

export default function NotificationDeliveryPage() {
  const t = useTranslations('notificationDelivery');

  return (
    <div className="space-y-4" data-testid={testIds.notificationDelivery.page}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>

      <Can I="read" a="NotificationDelivery" passThrough>
        {(allowed: boolean) =>
          allowed ? (
            <DeliveryLog />
          ) : (
            <div
              className="flex h-[50vh] items-center justify-center"
              data-testid={testIds.notificationDelivery.accessDenied}
            >
              <p className="text-muted-foreground">{t('accessDenied')}</p>
            </div>
          )
        }
      </Can>
    </div>
  );
}
