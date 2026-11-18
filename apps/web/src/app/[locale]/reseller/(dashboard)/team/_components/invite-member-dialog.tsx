'use client';

import { zodValidator } from '@roviq/i18n';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldGroup,
  useAppForm,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useRoleName } from '@web/hooks/use-role-name';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { useAssignableTeamRoles, useInviteTeamMember } from '../use-reseller-team';
import { useTeamErrorMessage } from '../use-team-error-message';

const { resellerTeam } = testIds;

const inviteSchema = z.object({
  email: z.string().trim().email().max(320),
  roleId: z.string().min(1),
});

const EMPTY = { email: '', roleId: '' };

export function InviteMemberDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('resellerTeam');
  const roleName = useRoleName();
  const errorMessage = useTeamErrorMessage();
  const { roles } = useAssignableTeamRoles();
  const [invite] = useInviteTeamMember();

  const form = useAppForm({
    defaultValues: EMPTY,
    validators: { onChange: zodValidator(inviteSchema), onSubmit: zodValidator(inviteSchema) },
    onSubmit: async ({ value }) => {
      const input = inviteSchema.parse(value);
      try {
        const { data } = await invite({ variables: { input } });
        toast.success(
          t('inviteDialog.success', { email: data?.resellerInviteTeamMember.email ?? input.email }),
        );
        onClose();
      } catch (err) {
        toast.error(errorMessage(err));
      }
    },
  });

  React.useEffect(() => {
    if (open) form.reset(EMPTY);
  }, [open, form]);

  const roleOptions = roles.map((role) => ({ value: role.id, label: roleName(role.name) }));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent data-testid={resellerTeam.inviteDialog}>
        <DialogHeader>
          <DialogTitle>{t('inviteDialog.title')}</DialogTitle>
          <DialogDescription>{t('inviteDialog.description')}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <FieldGroup>
            <form.AppField name="email">
              {(field) => (
                <field.TextField
                  label={t('inviteDialog.email')}
                  placeholder={t('inviteDialog.emailPlaceholder')}
                  type="email"
                  autoComplete="off"
                  testId={resellerTeam.inviteEmailInput}
                />
              )}
            </form.AppField>
            <form.AppField name="roleId">
              {(field) => (
                <field.SelectField
                  label={t('inviteDialog.role')}
                  placeholder={t('inviteDialog.rolePlaceholder')}
                  description={t('inviteDialog.roleHint')}
                  options={roleOptions}
                  testId={resellerTeam.inviteRoleSelect}
                />
              )}
            </form.AppField>
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              data-testid={resellerTeam.inviteCancelBtn}
            >
              {t('actions.cancel')}
            </Button>
            <form.AppForm>
              <form.SubmitButton
                testId={resellerTeam.inviteSubmitBtn}
                submittingLabel={t('inviteDialog.submitting')}
              >
                {t('inviteDialog.submit')}
              </form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
