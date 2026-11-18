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
import { ImpersonateUserDialog } from '@web/components/impersonation/impersonate-user-dialog';
import { Eye, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import {
  AdminImpersonateStartDocument,
  AdminImpersonateVerifyOtpDocument,
} from './users-tab.generated';

const LIST_INSTITUTE_USERS = gql`
  query AdminListInstituteUsers($tenantId: String!) {
    adminListUsers(filter: { tenantId: $tenantId, first: 50 }) {
      totalCount
      edges {
        node {
          id
          username
          email
          status
          profile {
            firstName
            lastName
          }
          memberships {
            id
            tenantId
            status
            roleId
            instituteName
          }
        }
      }
    }
  }
`;

export const ADMIN_IMPERSONATE_START = gql`
  mutation AdminImpersonateStart($targetUserId: String!, $targetTenantId: String!, $reason: String!) {
    adminStartImpersonation(
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

export const ADMIN_IMPERSONATE_VERIFY_OTP = gql`
  mutation AdminImpersonateVerifyOtp($sessionId: String!, $otp: String!) {
    adminVerifyImpersonationOtp(sessionId: $sessionId, otp: $otp) {
      code
      requiresOtp
      sessionId
    }
  }
`;

interface MembershipNode {
  id: string;
  tenantId: string;
  status: string;
  roleId: string;
  instituteName?: string | null;
}

interface UserNode {
  id: string;
  username: string;
  email: string;
  status: string;
  profile?: {
    firstName: Record<string, string>;
    lastName?: Record<string, string> | null;
  } | null;
  memberships: MembershipNode[];
}

interface Data {
  adminListUsers: {
    totalCount: number;
    edges: Array<{ node: UserNode }>;
  };
}

export function InstituteUsersTab({
  instituteId,
  instituteName,
}: {
  instituteId: string;
  instituteName: string;
}) {
  const t = useTranslations('adminInstitutes.users');
  const tImp = useTranslations('impersonation');
  const resolveI18n = useI18nField();
  const [target, setTarget] = React.useState<{ id: string; name: string } | null>(null);
  const [startMutation] = useMutation(AdminImpersonateStartDocument);
  const [verifyMutation] = useMutation(AdminImpersonateVerifyOtpDocument);

  const start = async (reason: string) => {
    if (!target) throw new Error('No impersonation target');
    const { data } = await startMutation({
      variables: { targetUserId: target.id, targetTenantId: instituteId, reason },
    });
    return data?.adminStartImpersonation ?? {};
  };
  const verifyOtp = async (sessionId: string, otp: string) => {
    const { data } = await verifyMutation({ variables: { sessionId, otp } });
    return data?.adminVerifyImpersonationOtp ?? {};
  };
  const { data, loading } = useQuery<Data>(LIST_INSTITUTE_USERS, {
    variables: { tenantId: instituteId },
    fetchPolicy: 'cache-and-network',
  });

  if (loading && !data) {
    return <Skeleton className="h-64 w-full" />;
  }

  const users = data?.adminListUsers.edges.map((e) => e.node) ?? [];

  if (users.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Empty className="py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Users />
              </EmptyMedia>
              <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
              <EmptyDescription>{t('emptyDescription')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid={testIds.adminInstituteDetail.usersTab}>
      <CardHeader>
        <CardTitle>
          {t('title')}
          <span className="ms-2 text-sm font-normal text-muted-foreground">
            ({data?.adminListUsers.totalCount ?? 0})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.name')}</TableHead>
              <TableHead>{t('columns.username')}</TableHead>
              <TableHead>{t('columns.email')}</TableHead>
              <TableHead>{t('columns.roles')}</TableHead>
              <TableHead>{t('columns.status')}</TableHead>
              <TableHead>
                <span className="sr-only">{t('columns.actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => {
              const name = user.profile
                ? `${resolveI18n(user.profile.firstName)}${
                    user.profile.lastName ? ` ${resolveI18n(user.profile.lastName)}` : ''
                  }`
                : user.username;
              const membershipsInInstitute = user.memberships.filter(
                (m) => m.tenantId === instituteId,
              );
              return (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{name}</TableCell>
                  <TableCell className="font-mono text-xs">{user.username}</TableCell>
                  <TableCell className="text-sm">{user.email}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {membershipsInInstitute.map((m) => (
                        <Badge key={m.id} variant="outline" className="text-xs">
                          {m.roleId}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.status === 'ACTIVE' ? 'default' : 'secondary'}>
                      {t(`statuses.${user.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-end">
                    {user.status === 'ACTIVE' &&
                      membershipsInInstitute.some((m) => m.status === 'ACTIVE') && (
                        <Can I="impersonate" a="User">
                          <Button
                            size="sm"
                            variant="outline"
                            title={tImp('actionTitle')}
                            data-testid={testIds.impersonation.trigger(user.id)}
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

import { testIds } from '@roviq/ui/testing/testid-registry';
