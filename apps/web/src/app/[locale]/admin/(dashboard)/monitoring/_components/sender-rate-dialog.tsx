'use client';

import { extractGraphQLErrorCode, useMutation } from '@roviq/graphql';
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
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { AdminUpdateSenderRateDocument } from '../_lib/notification-health.graphql.generated';

const { adminMonitoring: ids } = testIds;

/** The API and the database CHECK hold the same bounds. */
export const SENDER_RATE_MIN = 1;
export const SENDER_RATE_MAX = 1000;

const ERROR_CODES = ['VALIDATION_FAILED', 'MESSAGING_SENDER_NOT_FOUND', 'FORBIDDEN'] as const;
type KnownCode = (typeof ERROR_CODES)[number];
const isKnownCode = (code: string | null | undefined): code is KnownCode =>
  ERROR_CODES.some((known) => known === code);

export interface SenderRateTarget {
  id: string;
  displayNumber: string;
  messagesPerSecond: number;
}

export function SenderRateDialog({
  sender,
  open,
  onClose,
}: {
  sender: SenderRateTarget;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('adminMonitoring.notifications');
  const [updateRate] = useMutation(AdminUpdateSenderRateDocument, {
    refetchQueries: ['AdminMonitoringSenders'],
  });
  const schema = React.useMemo(
    () =>
      z.object({
        messagesPerSecond: z
          .number({ error: t('senderRateInvalid') })
          .int(t('senderRateInvalid'))
          .min(SENDER_RATE_MIN, t('senderRateInvalid'))
          .max(SENDER_RATE_MAX, t('senderRateInvalid')),
      }),
    [t],
  );

  const form = useAppForm({
    defaultValues: { messagesPerSecond: sender.messagesPerSecond as number | undefined },
    validators: { onChange: zodValidator(schema), onSubmit: zodValidator(schema) },
    onSubmit: async ({ value }) => {
      const { messagesPerSecond } = schema.parse(value);
      try {
        await updateRate({ variables: { id: sender.id, messagesPerSecond } });
        toast.success(t('senderRateSaved'));
        onClose();
      } catch (err) {
        const code = extractGraphQLErrorCode(err);
        toast.error(t(`senderRateErrors.${isKnownCode(code) ? code : 'other'}`));
      }
    },
  });

  React.useEffect(() => {
    if (open) form.reset({ messagesPerSecond: sender.messagesPerSecond });
  }, [open, form, sender.messagesPerSecond]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid={ids.senderRateDialog}>
        <DialogHeader>
          <DialogTitle>{t('senderRateDialogTitle')}</DialogTitle>
          <DialogDescription>
            {t('senderRateDialogDescription', { number: sender.displayNumber })}
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
          className="space-y-6"
        >
          <FieldGroup>
            <form.AppField name="messagesPerSecond">
              {(field) => (
                <field.NumberField
                  label={t('senderRateLabel')}
                  description={t('senderRateHint')}
                  min={SENDER_RATE_MIN}
                  max={SENDER_RATE_MAX}
                  step={1}
                  required
                  testId={ids.senderRateInput}
                />
              )}
            </form.AppField>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('senderRateCancel')}
            </Button>
            <form.AppForm>
              <form.SubmitButton
                testId={ids.senderRateSave}
                submittingLabel={t('senderRateSaving')}
              >
                {t('senderRateSave')}
              </form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
