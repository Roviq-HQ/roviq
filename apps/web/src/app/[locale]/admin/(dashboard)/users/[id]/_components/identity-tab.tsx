'use client';

import {
  Badge,
  Card,
  CardContent,
  Empty,
  EmptyHeader,
  EmptyTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { BadgeCheck, CircleDashed } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { UserDetail } from '../../types';

const { adminUserDetail } = testIds;

export function IdentityTab({ identifiers }: { identifiers: UserDetail['identifiers'] }) {
  const t = useTranslations('adminUsers.identity');

  if (identifiers.length === 0) {
    return (
      <Empty className="py-12" data-testid={adminUserDetail.empty('identity')}>
        <EmptyHeader>
          <EmptyTitle>{t('empty')}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <p className="mb-3 text-xs text-muted-foreground">{t('maskingNote')}</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.type')}</TableHead>
              <TableHead>{t('columns.value')}</TableHead>
              <TableHead>{t('columns.verified')}</TableHead>
              <TableHead>{t('columns.issuingAuthority')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {identifiers.map((id) => (
              <TableRow key={id.id} data-testid={adminUserDetail.identifierRow(id.id)}>
                <TableCell className="font-medium">{t(`types.${id.type}`)}</TableCell>
                <TableCell
                  className="font-mono text-sm"
                  data-testid={adminUserDetail.identifierValue(id.id)}
                >
                  {id.displayValue ?? t('hidden')}
                </TableCell>
                <TableCell>
                  {id.isVerified ? (
                    <Badge variant="default" className="gap-1">
                      <BadgeCheck className="size-3" aria-hidden />
                      {t('verified')}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1">
                      <CircleDashed className="size-3" aria-hidden />
                      {t('unverified')}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>{id.issuingAuthority ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
