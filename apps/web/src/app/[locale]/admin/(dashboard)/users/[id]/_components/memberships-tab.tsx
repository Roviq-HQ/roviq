'use client';

import { useFormatDate, useI18nField } from '@roviq/i18n';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { UserDetail } from '../../types';
import { MEMBERSHIP_STATUS_VARIANT } from '../../user-badge-styles';

const { adminUserDetail } = testIds;

export function MembershipsTab({ user }: { user: UserDetail }) {
  const t = useTranslations('adminUsers.memberships');
  const { format } = useFormatDate();
  const resolveI18n = useI18nField();
  const date = (d: string) => format(new Date(d), 'dd/MM/yyyy');
  const activeLabel = (isActive: boolean) => (isActive ? t('active') : t('inactive'));
  const hasAny =
    user.memberships.length > 0 ||
    user.resellerMemberships.length > 0 ||
    user.platformMembership != null;

  if (!hasAny) {
    return (
      <Empty className="py-12" data-testid={adminUserDetail.empty('memberships')}>
        <EmptyHeader>
          <EmptyTitle>{t('empty')}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="space-y-4">
      {user.memberships.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('institutes')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('columns.institute')}</TableHead>
                  <TableHead>{t('columns.role')}</TableHead>
                  <TableHead>{t('columns.status')}</TableHead>
                  <TableHead>{t('columns.joined')}</TableHead>
                  <TableHead className="text-end">{t('columns.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {user.memberships.map((m) => (
                  <TableRow key={m.id} data-testid={adminUserDetail.membershipRow(m.id)}>
                    <TableCell className="font-medium">
                      {resolveI18n(m.instituteName) || '—'}
                    </TableCell>
                    <TableCell>{resolveI18n(m.roleName) || '—'}</TableCell>
                    <TableCell>
                      <Badge variant={MEMBERSHIP_STATUS_VARIANT[m.status]}>
                        {t(`statuses.${m.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>{date(m.joinedAt)}</TableCell>
                    <TableCell className="text-end">
                      <Button
                        asChild
                        variant="ghost"
                        size="sm"
                        title={t('viewInstitute')}
                        data-testid={adminUserDetail.viewInstituteBtn(m.id)}
                      >
                        <Link href={`/admin/institutes/${m.tenantId}`}>
                          <ExternalLink className="me-1 size-4" />
                          {t('viewInstitute')}
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {user.resellerMemberships.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('resellers')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('columns.reseller')}</TableHead>
                  <TableHead>{t('columns.role')}</TableHead>
                  <TableHead>{t('columns.status')}</TableHead>
                  <TableHead>{t('columns.joined')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {user.resellerMemberships.map((m) => (
                  <TableRow key={m.id} data-testid={adminUserDetail.resellerMembershipRow(m.id)}>
                    <TableCell className="font-medium">
                      <Link className="hover:underline" href={`/admin/resellers/${m.resellerId}`}>
                        {m.resellerName}
                      </Link>
                    </TableCell>
                    <TableCell>{resolveI18n(m.roleName) || '—'}</TableCell>
                    <TableCell>
                      <Badge variant={m.isActive ? 'default' : 'outline'}>
                        {activeLabel(m.isActive)}
                      </Badge>
                    </TableCell>
                    <TableCell>{date(m.joinedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {user.platformMembership && (
        <Card data-testid={adminUserDetail.platformMembershipRow}>
          <CardHeader>
            <CardTitle>{t('platform')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium">
              {resolveI18n(user.platformMembership.roleName) || '—'}
            </span>
            <Badge variant={user.platformMembership.isActive ? 'default' : 'outline'}>
              {activeLabel(user.platformMembership.isActive)}
            </Badge>
            <span className="text-muted-foreground">
              {t('joinedOn', { date: date(user.platformMembership.joinedAt) })}
            </span>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
