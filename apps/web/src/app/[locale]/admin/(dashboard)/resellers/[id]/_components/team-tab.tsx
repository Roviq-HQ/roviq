'use client';

import { gql, useQuery } from '@roviq/graphql';
import { useFormatDate, useI18nField } from '@roviq/i18n';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useRoleName } from '@web/hooks/use-role-name';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AdminResellerTeamDocument } from './team-tab.generated';

const { adminResellerDetail } = testIds;

export const ADMIN_RESELLER_TEAM = gql`
  query AdminResellerTeam($resellerId: ID!) {
    adminListResellerTeam(resellerId: $resellerId) {
      id
      userId
      username
      email
      firstName
      lastName
      roleName
      isActive
      joinedAt
      lastActiveAt
    }
  }
`;

/** Read-only staff list: the reseller manages its own team from the reseller portal. */
export function ResellerTeamTab({ resellerId }: { resellerId: string }) {
  const t = useTranslations('adminResellers.team');
  const resolveI18n = useI18nField();
  const roleName = useRoleName();
  const { format, formatDistance } = useFormatDate();
  const { data, loading } = useQuery(AdminResellerTeamDocument, {
    variables: { resellerId },
    fetchPolicy: 'cache-and-network',
  });
  const members = data?.adminListResellerTeam ?? [];

  if (loading && !data) {
    return (
      <div className="space-y-2" data-testid={adminResellerDetail.teamLoading}>
        {Array.from({ length: 3 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <Empty className="py-12" data-testid={adminResellerDetail.teamEmpty}>
        <EmptyHeader>
          <EmptyTitle>{t('empty')}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Card data-testid={adminResellerDetail.teamTab}>
      <CardHeader>
        <CardTitle>{t('title', { count: members.length })}</CardTitle>
        <CardDescription>{t('readOnlyNote')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.name')}</TableHead>
              <TableHead>{t('columns.email')}</TableHead>
              <TableHead>{t('columns.role')}</TableHead>
              <TableHead>{t('columns.status')}</TableHead>
              <TableHead>{t('columns.lastActive')}</TableHead>
              <TableHead>{t('columns.joined')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => {
              const fullName = [resolveI18n(m.firstName), resolveI18n(m.lastName)]
                .filter(Boolean)
                .join(' ');
              return (
                <TableRow key={m.id} data-testid={adminResellerDetail.teamRow(m.id)}>
                  <TableCell className="font-medium">
                    <Link href={`/admin/users/${m.userId}`} className="hover:underline">
                      {fullName || m.username}
                    </Link>
                  </TableCell>
                  <TableCell>{m.email}</TableCell>
                  <TableCell>{roleName(m.roleName) || '—'}</TableCell>
                  <TableCell>
                    <Badge variant={m.isActive ? 'default' : 'secondary'}>
                      {m.isActive ? t('active') : t('inactive')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {m.lastActiveAt
                      ? formatDistance(new Date(m.lastActiveAt), new Date())
                      : t('neverActive')}
                  </TableCell>
                  <TableCell>{format(new Date(m.joinedAt), 'dd/MM/yyyy')}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
