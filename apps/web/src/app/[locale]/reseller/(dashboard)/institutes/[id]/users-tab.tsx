'use client';

import { gql, useMutation, useQuery } from '@roviq/graphql';
import { useI18nField } from '@roviq/i18n';
import {
  Badge,
  Button,
  Can,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
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
import { ImpersonateUserDialog } from '@web/components/impersonation/impersonate-user-dialog';
import { Eye, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import {
  ResellerImpersonateStartDocument,
  ResellerImpersonateVerifyOtpDocument,
  ResellerInstituteUsersDocument,
} from './users-tab.generated';

export const RESELLER_INSTITUTE_USERS = gql`
  query ResellerInstituteUsers($instituteId: String!) {
    resellerListUsers(filter: { instituteId: $instituteId, first: 50 }) {
      totalCount
      edges {
        node {
          id
          username
          status
          profile {
            firstName
            lastName
          }
          memberships {
            id
            tenantId
            status
          }
        }
      }
    }
  }
`;

export const RESELLER_IMPERSONATE_START = gql`
  mutation ResellerImpersonateStart(
    $targetUserId: String!
    $targetTenantId: String!
    $reason: String!
  ) {
    resellerStartImpersonation(
      targetUserId: $targetUserId
      targetTenantId: $targetTenantId
      reason: $reason
    ) {
      code
      requiresOtp
      sessionId
    }
  }
`;

export const RESELLER_IMPERSONATE_VERIFY_OTP = gql`
  mutation ResellerImpersonateVerifyOtp($sessionId: String!, $otp: String!) {
    resellerVerifyImpersonationOtp(sessionId: $sessionId, otp: $otp) {
      code
      requiresOtp
      sessionId
    }
  }
`;

const { resellerInstituteDetail: ids, impersonation: impIds } = testIds;

export function ResellerInstituteUsersTab({
  instituteId,
  instituteName,
}: {
  instituteId: string;
  instituteName: string;
}) {
  const t = useTranslations('resellerInstitutes.users');
  const tImp = useTranslations('impersonation');
  const resolveI18n = useI18nField();
  const [target, setTarget] = React.useState<{ id: string; name: string } | null>(null);
  const { data, loading, error } = useQuery(ResellerInstituteUsersDocument, {
    variables: { instituteId },
    fetchPolicy: 'cache-and-network',
  });
  const [startMutation] = useMutation(ResellerImpersonateStartDocument);
  const [verifyMutation] = useMutation(ResellerImpersonateVerifyOtpDocument);

  const start = async (reason: string) => {
    if (!target) throw new Error('No impersonation target');
    const result = await startMutation({
      variables: { targetUserId: target.id, targetTenantId: instituteId, reason },
    });
    return result.data?.resellerStartImpersonation ?? {};
  };
  const verifyOtp = async (sessionId: string, otp: string) => {
    const result = await verifyMutation({ variables: { sessionId, otp } });
    return result.data?.resellerVerifyImpersonationOtp ?? {};
  };

  if (loading && !data) {
    return <Skeleton className="h-64 w-full" data-testid={ids.usersLoading} />;
  }

  const users = data?.resellerListUsers.edges.map((edge) => edge.node) ?? [];

  if (error || users.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Empty className="py-8" data-testid={ids.usersEmpty}>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Users />
              </EmptyMedia>
              <EmptyTitle>{error ? t('loadFailed') : t('emptyTitle')}</EmptyTitle>
              <EmptyDescription>
                {error ? t('loadFailedHint') : t('emptyDescription')}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid={ids.usersTab}>
      <CardHeader>
        <CardTitle>
          {t('title')}
          <span className="ms-2 text-sm font-normal text-muted-foreground">
            ({data?.resellerListUsers.totalCount ?? 0})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.name')}</TableHead>
              <TableHead>{t('columns.username')}</TableHead>
              <TableHead>{t('columns.status')}</TableHead>
              <TableHead>
                <span className="sr-only">{t('columns.actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => {
              const name = user.profile
                ? [resolveI18n(user.profile.firstName), resolveI18n(user.profile.lastName)]
                    .filter(Boolean)
                    .join(' ')
                : user.username;
              const activeHere = user.memberships.some(
                (m) => m.tenantId === instituteId && m.status === 'ACTIVE',
              );
              return (
                <TableRow key={user.id} data-testid={ids.userRow(user.id)}>
                  <TableCell className="font-medium">{name}</TableCell>
                  <TableCell className="font-mono text-xs">{user.username}</TableCell>
                  <TableCell>
                    <Badge variant={user.status === 'ACTIVE' ? 'default' : 'secondary'}>
                      {t(`statuses.${user.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-end">
                    {user.status === 'ACTIVE' && activeHere && (
                      <Can I="impersonate" a="User">
                        <Button
                          size="sm"
                          variant="outline"
                          title={tImp('actionTitle')}
                          data-testid={impIds.trigger(user.id)}
                          onClick={() => setTarget({ id: user.id, name })}
                        >
                          <Eye aria-hidden="true" />
                          {tImp('action')}
                        </Button>
                      </Can>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
      <ImpersonateUserDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        targetName={target?.name ?? ''}
        instituteName={instituteName}
        start={start}
        verifyOtp={verifyOtp}
      />
    </Card>
  );
}
