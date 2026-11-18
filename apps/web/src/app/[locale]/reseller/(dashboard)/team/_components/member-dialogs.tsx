'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useRoleName } from '@web/hooks/use-role-name';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import {
  type TeamMember,
  useAssignableTeamRoles,
  useChangeTeamMemberRole,
  useDeactivateTeamMember,
  useReactivateTeamMember,
} from '../use-reseller-team';
import { useTeamErrorMessage } from '../use-team-error-message';
import { useMemberName } from './use-member-name';

const { resellerTeam } = testIds;

export type MemberDialog = { kind: 'role' | 'deactivate' | 'reactivate'; member: TeamMember };

interface Props {
  member: TeamMember;
  onClose: () => void;
}

export function ChangeRoleDialog({ member, onClose }: Props) {
  const t = useTranslations('resellerTeam');
  const roleName = useRoleName();
  const memberName = useMemberName();
  const errorMessage = useTeamErrorMessage();
  const { roles } = useAssignableTeamRoles();
  const [changeRole, { loading }] = useChangeTeamMemberRole();
  const [roleId, setRoleId] = React.useState(member.roleId);
  const name = memberName(member);
  const selected = roles.find((role) => role.id === roleId);

  const submit = async () => {
    try {
      const { data } = await changeRole({ variables: { membershipId: member.id, roleId } });
      toast.success(
        t('roleDialog.success', {
          name,
          role: roleName(data?.resellerChangeTeamMemberRole.roleName),
        }),
      );
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && !loading && onClose()}>
      <DialogContent data-testid={resellerTeam.roleDialog}>
        <DialogHeader>
          <DialogTitle>{t('roleDialog.title', { name })}</DialogTitle>
          <DialogDescription>{t('roleDialog.description')}</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="team-member-role">{t('roleDialog.role')}</FieldLabel>
          <Select value={roleId} onValueChange={setRoleId}>
            <SelectTrigger id="team-member-role" data-testid={resellerTeam.roleSelect}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roles.map((role) => (
                <SelectItem
                  key={role.id}
                  value={role.id}
                  data-testid={resellerTeam.roleOption(role.name.en ?? role.id)}
                >
                  {roleName(role.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            {roleId === member.roleId
              ? t('roleDialog.unchanged')
              : selected && t.has(`roleHelp.${selected.name.en}`)
                ? t(`roleHelp.${selected.name.en}`)
                : null}
          </FieldDescription>
        </Field>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={loading}
            data-testid={resellerTeam.roleCancelBtn}
          >
            {t('actions.cancel')}
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={loading || roleId === member.roleId}
            data-testid={resellerTeam.roleSubmitBtn}
          >
            {loading ? t('actions.saving') : t('roleDialog.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StatusConfirmDialog({
  member,
  onClose,
  kind,
}: Props & { kind: 'deactivate' | 'reactivate' }) {
  const t = useTranslations('resellerTeam');
  const memberName = useMemberName();
  const errorMessage = useTeamErrorMessage();
  const [deactivate, deactivating] = useDeactivateTeamMember();
  const [reactivate, reactivating] = useReactivateTeamMember();
  const loading = deactivating.loading || reactivating.loading;
  const name = memberName(member);
  const copy = kind === 'deactivate' ? 'deactivateDialog' : 'reactivateDialog';

  const confirm = async (event: React.MouseEvent) => {
    // Keep the dialog open until the request settles, so a failure is not lost.
    event.preventDefault();
    try {
      const run = kind === 'deactivate' ? deactivate : reactivate;
      await run({ variables: { membershipId: member.id } });
      toast.success(t(`${copy}.success`, { name }));
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <AlertDialog open onOpenChange={(next) => !next && !loading && onClose()}>
      <AlertDialogContent data-testid={resellerTeam.confirmDialog}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(`${copy}.title`, { name })}</AlertDialogTitle>
          <AlertDialogDescription>{t(`${copy}.description`)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading} data-testid={resellerTeam.confirmCancelBtn}>
            {t('actions.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={confirm}
            disabled={loading}
            className={
              kind === 'deactivate'
                ? 'bg-destructive text-white hover:bg-destructive/90'
                : undefined
            }
            data-testid={resellerTeam.confirmBtn}
          >
            {loading ? t('actions.saving') : t(`${copy}.confirm`)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
