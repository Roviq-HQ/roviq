'use client';

import { useAuth } from '@roviq/auth';
import { gql, useMutation } from '@roviq/graphql';
import { Button, Can } from '@roviq/ui';
import { Eye } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import {
  AdminImpersonateStartDocument,
  AdminImpersonateVerifyOtpDocument,
} from './admin-impersonate-button.generated';
import { ImpersonateUserDialog } from './impersonate-user-dialog';

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

export interface AdminImpersonateButtonProps {
  userId: string;
  tenantId: string;
  targetName: string;
  instituteName: string;
  testId: string;
}

/**
 * "View as" for a platform user: one institute membership of one user. The institute
 * may ask for its admin's OTP, which the dialog then collects. Render it only for an
 * active user with an active membership; the server refuses the rest.
 */
export function AdminImpersonateButton({
  userId,
  tenantId,
  targetName,
  instituteName,
  testId,
}: AdminImpersonateButtonProps) {
  const t = useTranslations('impersonation');
  const { user } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [startMutation] = useMutation(AdminImpersonateStartDocument);
  const [verifyMutation] = useMutation(AdminImpersonateVerifyOtpDocument);

  // Nobody views as themselves.
  if (user?.id === userId) return null;

  const start = async (reason: string) => {
    const { data } = await startMutation({
      variables: { targetUserId: userId, targetTenantId: tenantId, reason },
    });
    return data?.adminStartImpersonation ?? {};
  };
  const verifyOtp = async (sessionId: string, otp: string) => {
    const { data } = await verifyMutation({ variables: { sessionId, otp } });
    return data?.adminVerifyImpersonationOtp ?? {};
  };

  return (
    <Can I="impersonate" a="User">
      <Button
        size="sm"
        variant="outline"
        title={t('actionTitle')}
        data-testid={testId}
        onClick={() => setOpen(true)}
      >
        <Eye aria-hidden="true" />
        {t('action')}
      </Button>
      <ImpersonateUserDialog
        open={open}
        onOpenChange={setOpen}
        targetName={targetName}
        instituteName={instituteName}
        start={start}
        verifyOtp={verifyOtp}
      />
    </Can>
  );
}
