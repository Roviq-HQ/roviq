'use client';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  EmptyHeader,
  EmptyTitle,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useTranslations } from 'next-intl';
import type { UserDetail } from '../../types';

const { adminUserDetail } = testIds;

export function AddressesTab({ addresses }: { addresses: UserDetail['addresses'] }) {
  const t = useTranslations('adminUsers.addresses');

  if (addresses.length === 0) {
    return (
      <Empty className="py-12" data-testid={adminUserDetail.empty('addresses')}>
        <EmptyHeader>
          <EmptyTitle>{t('empty')}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {addresses.map((a) => (
        <Card key={a.id} data-testid={adminUserDetail.addressCard(a.id)}>
          <CardHeader>
            <CardTitle className="text-base">{t(`types.${a.type}`)}</CardTitle>
          </CardHeader>
          <CardContent>
            <address className="space-y-0.5 text-sm not-italic">
              {[a.line1, a.line2, a.line3].filter(Boolean).map((line) => (
                <div key={line}>{line}</div>
              ))}
              <div>{a.city}</div>
              {a.district && (
                <div>
                  <span className="text-muted-foreground">{t('district')}: </span>
                  {a.district}
                </div>
              )}
              <div>
                {a.state} {a.postalCode}
              </div>
              <div>{a.country}</div>
            </address>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
