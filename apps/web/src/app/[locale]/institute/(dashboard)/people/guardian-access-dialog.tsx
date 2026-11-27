'use client';

import { extractGraphQLErrorCode } from '@roviq/graphql';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Can,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  useMediaQuery,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { AlertCircle, ShieldCheck, ShieldOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { useRestoreGuardianAccess, useRevokeGuardianAccess } from './guardians/use-guardians';

const { institutePeople } = testIds;

const KNOWN_ERROR_CODES = ['GUARDIAN_LINK_NOT_FOUND', 'FORBIDDEN'] as const;
type ErrorKey = (typeof KNOWN_ERROR_CODES)[number] | 'unknown';

function errorKey(code: string | null): ErrorKey {
  return KNOWN_ERROR_CODES.find((known) => known === code) ?? 'unknown';
}

interface GuardianAccessButtonProps {
  linkId: string;
  studentProfileId: string;
  guardianProfileId: string;
  studentName: string;
  guardianName: string;
  /** The guardian's access to this student is closed now. */
  revoked: boolean;
}

/**
 * Closes or opens again one guardian's parent-portal access to one student, without removing
 * the link. Shown to roles that manage guardians.
 */
export function GuardianAccessButton(props: GuardianAccessButtonProps) {
  const t = useTranslations('peopleLinks.access');
  const [open, setOpen] = React.useState(false);
  const mode = props.revoked ? 'restore' : 'revoke';
  const names = { guardian: props.guardianName, student: props.studentName };
  const Icon = props.revoked ? ShieldCheck : ShieldOff;

  return (
    <Can I="manage" a="Guardian">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        title={t(`${mode}.buttonTitle`, names)}
        data-testid={
          props.revoked
            ? institutePeople.accessRestoreBtn(props.linkId)
            : institutePeople.accessRevokeBtn(props.linkId)
        }
      >
        <Icon aria-hidden="true" className="size-4" />
        {t(`${mode}.button`)}
      </Button>
      {open && <GuardianAccessDialog {...props} open={open} onOpenChange={setOpen} />}
    </Can>
  );
}

function GuardianAccessDialog({
  studentProfileId,
  guardianProfileId,
  studentName,
  guardianName,
  revoked,
  open,
  onOpenChange,
}: GuardianAccessButtonProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations('peopleLinks.access');
  const isMobile = useMediaQuery('(max-width: 1024px)');
  const [revoke, { loading: revoking }] = useRevokeGuardianAccess();
  const [restore, { loading: restoring }] = useRestoreGuardianAccess();
  const [failure, setFailure] = React.useState<ErrorKey | null>(null);
  // Fixed for the life of the dialog: the list refetches while it closes.
  const [mode] = React.useState<'revoke' | 'restore'>(revoked ? 'restore' : 'revoke');
  const working = revoking || restoring;
  const names = { guardian: guardianName, student: studentName };

  async function handleConfirm() {
    setFailure(null);
    const variables = { input: { guardianProfileId, studentProfileId } };
    try {
      await (mode === 'revoke' ? revoke({ variables }) : restore({ variables }));
      toast.success(t(`${mode}.success`, names));
      onOpenChange(false);
    } catch (err) {
      setFailure(errorKey(extractGraphQLErrorCode(err)));
    }
  }

  const body = failure && (
    <Alert variant="destructive" data-testid={institutePeople.accessError}>
      <AlertCircle aria-hidden="true" className="size-4" />
      <AlertTitle>{t(`${mode}.failed`, names)}</AlertTitle>
      <AlertDescription>{t(`errors.${failure}`, names)}</AlertDescription>
    </Alert>
  );

  const actions = (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => onOpenChange(false)}
        disabled={working}
        data-testid={institutePeople.accessCancelBtn}
      >
        {t('cancel')}
      </Button>
      <Button
        type="button"
        variant={mode === 'revoke' ? 'destructive' : 'default'}
        onClick={handleConfirm}
        disabled={working}
        data-testid={institutePeople.accessConfirmBtn}
      >
        {working ? t(`${mode}.working`) : t(`${mode}.confirm`)}
      </Button>
    </>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="max-h-[90vh] overflow-y-auto"
          data-testid={institutePeople.accessDialog}
        >
          <SheetHeader>
            <SheetTitle>{t(`${mode}.title`, names)}</SheetTitle>
            <SheetDescription>{t(`${mode}.consequence`, names)}</SheetDescription>
          </SheetHeader>
          <div className="px-4">{body}</div>
          <SheetFooter className="sticky bottom-0 border-t bg-background pt-4">
            {actions}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid={institutePeople.accessDialog}>
        <DialogHeader>
          <DialogTitle>{t(`${mode}.title`, names)}</DialogTitle>
          <DialogDescription>{t(`${mode}.consequence`, names)}</DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter>{actions}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
