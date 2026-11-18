'use client';

import { useAuth } from '@roviq/auth';
import { gql, useMutation } from '@roviq/graphql';
import { useI18nField } from '@roviq/i18n';
import { Button, Can } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { Eye } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { ImpersonateUserDialog } from './impersonate-user-dialog';
import { InstituteImpersonateStartDocument } from './view-as-button.generated';

export const INSTITUTE_IMPERSONATE_START = gql`
  mutation InstituteImpersonateStart($targetUserId: String!, $reason: String!) {
    impersonateUser(targetUserId: $targetUserId, reason: $reason) {
      code
      requiresOtp
      sessionId
    }
  }
`;

/**
 * "View as" for institute staff (intra-institute impersonation). Shown to roles that can
 * impersonate; the server refuses a target whose role ranks equal to or above the caller's.
 */
export function ViewAsButton({ userId, name }: { userId: string; name: string }) {
  const t = useTranslations('impersonation');
  const resolveI18n = useI18nField();
  const { user, memberships, isImpersonated } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [startMutation] = useMutation(InstituteImpersonateStartDocument);

  // An impersonation tab cannot start another one, and no one views as themselves.
  if (isImpersonated || user?.id === userId) return null;

  const instituteName = resolveI18n(
    memberships?.find((m) => m.tenantId === user?.tenantId)?.instituteName,
  );

  const start = async (reason: string) => {
    const { data } = await startMutation({ variables: { targetUserId: userId, reason } });
    return data?.impersonateUser ?? {};
  };

  return (
    <Can I="impersonate" a="User">
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
    </Can>
  );
}
