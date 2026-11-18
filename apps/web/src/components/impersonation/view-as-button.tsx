'use client';

import { useAuth } from '@roviq/auth';
import { gql, useMutation, useQuery } from '@roviq/graphql';
import { useI18nField } from '@roviq/i18n';
import { Button, useAbility } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { Eye } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { ImpersonateUserDialog } from './impersonate-user-dialog';
import {
  CanImpersonateUserDocument,
  InstituteImpersonateStartDocument,
} from './view-as-button.generated';

export const INSTITUTE_IMPERSONATE_START = gql`
  mutation InstituteImpersonateStart($targetUserId: String!, $reason: String!) {
    impersonateUser(targetUserId: $targetUserId, reason: $reason) {
      code
      requiresOtp
      sessionId
    }
  }
`;

export const CAN_IMPERSONATE_USER = gql`
  query CanImpersonateUser($targetUserId: String!) {
    canImpersonateUser(targetUserId: $targetUserId)
  }
`;

/**
 * "View as" for institute staff (intra-institute impersonation). Shown only when the
 * server says this person can be viewed as: it knows every role they hold, and refuses
 * one that ranks equal to or above the caller's.
 */
export function ViewAsButton({ userId, name }: { userId: string; name: string }) {
  const t = useTranslations('impersonation');
  const resolveI18n = useI18nField();
  const { user, memberships, isImpersonated } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [startMutation] = useMutation(InstituteImpersonateStartDocument);
  const ability = useAbility();
  // An impersonation tab cannot start another one, and no one views as themselves.
  const eligible = !isImpersonated && user?.id !== userId && ability.can('impersonate', 'User');
  const { data } = useQuery(CanImpersonateUserDocument, {
    variables: { targetUserId: userId },
    skip: !eligible,
  });

  if (!eligible || !data?.canImpersonateUser) return null;

  const instituteName = resolveI18n(
    memberships?.find((m) => m.tenantId === user?.tenantId)?.instituteName,
  );

  const start = async (reason: string) => {
    const { data } = await startMutation({ variables: { targetUserId: userId, reason } });
    return data?.impersonateUser ?? {};
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 print:hidden"
        title={t('actionTitle')}
        data-testid={testIds.impersonation.trigger(userId)}
        onClick={() => setOpen(true)}
      >
        <Eye className="size-4" aria-hidden="true" />
        {t('action')}
      </Button>
      <ImpersonateUserDialog
        open={open}
        onOpenChange={setOpen}
        targetName={name}
        instituteName={instituteName}
        start={start}
      />
    </>
  );
}
