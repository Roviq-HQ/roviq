'use client';

import { useAuth } from '@roviq/auth';
import { extractGraphQLErrorCode } from '@roviq/graphql';
import { useRouter, zodValidator } from '@roviq/i18n';
import { Button, Can, Field, FieldError, FieldGroup, FieldLabel, useAppForm } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { FileUpload } from '@web/components/file-upload/file-upload';
import { fileUploadErrorKey } from '@web/components/file-upload/use-file-upload';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { useStudents } from '../../people/students/use-students';
import { ApplicantPicker } from '../applicant-picker';
import { useApplicantMode, useMayApplyFor } from '../leave-abilities';
import { applyLeaveErrorKey } from '../leave-errors';
import { LEAVE_TYPE_VALUES, type LeaveType, useApplyLeave } from '../use-leave';
import { useOwnName } from '../use-own-name';

const { instituteLeave } = testIds;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const REASON_MAX = 1000;
const MAX_LEAVE_FILES = 10;

interface ApplyLeaveFormValues {
  userId: string;
  type: LeaveType | '';
  startDate: string;
  endDate: string;
  reason: string;
  fileIds: string[];
}

const EMPTY_FORM: ApplyLeaveFormValues = {
  userId: '',
  type: '',
  startDate: '',
  endDate: '',
  reason: '',
  fileIds: [],
};

function daysBetween(start: string, end: string): number {
  // Inclusive day span — a 1-day leave has start===end and spans 1 day.
  // Parses without timezones so +05:30 can't drift the count.
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const s = new Date(sy ?? 1970, (sm ?? 1) - 1, sd ?? 1).getTime();
  const e = new Date(ey ?? 1970, (em ?? 1) - 1, ed ?? 1).getTime();
  return Math.round((e - s) / 86_400_000) + 1;
}

function buildSchema(t: ReturnType<typeof useTranslations>) {
  return z
    .object({
      userId: z.string().uuid(t('errors.required.userId')),
      type: z.enum(LEAVE_TYPE_VALUES, { error: t('errors.required.type') }),
      startDate: z.string().regex(ISO_DATE_REGEX, t('errors.required.startDate')),
      endDate: z.string().regex(ISO_DATE_REGEX, t('errors.required.endDate')),
      reason: z.string().trim().min(1, t('errors.required.reason')).max(REASON_MAX),
      fileIds: z.array(z.string()),
    })
    .refine((d) => d.startDate <= d.endDate, {
      path: ['endDate'],
      message: t('errors.END_BEFORE_START'),
    })
    .refine(
      (d) => {
        const days = daysBetween(d.startDate, d.endDate);
        if (days <= 2) return true;
        return d.fileIds.length >= 1;
      },
      {
        path: ['fileIds'],
        message: t('errors.FILES_REQUIRED_GT2_DAYS'),
      },
    );
}

export default function ApplyLeavePage() {
  const t = useTranslations('leave');
  const tFiles = useTranslations('fileUpload');
  const router = useRouter();
  const { user } = useAuth();
  const [uploading, setUploading] = React.useState(false);
  const { apply } = useApplyLeave();

  const schema = React.useMemo(() => buildSchema(t), [t]);
  const applicantMode = useApplicantMode();

  const form = useAppForm({
    defaultValues: {
      ...EMPTY_FORM,
      // A guardian is not an applicant, so only staff and students start as themself.
      userId: applicantMode === 'children' ? '' : (user?.membershipId ?? ''),
    } satisfies ApplyLeaveFormValues,
    validators: { onChange: zodValidator(schema), onSubmit: zodValidator(schema) },
    onSubmit: async ({ value }) => {
      const parsed = schema.parse(value);
      try {
        await apply({
          userId: parsed.userId,
          type: parsed.type as LeaveType,
          startDate: parsed.startDate,
          endDate: parsed.endDate,
          reason: parsed.reason,
          fileIds: parsed.fileIds,
        });
        toast.success(t('toasts.applied'));
        router.push('/leave');
      } catch (err) {
        const code = extractGraphQLErrorCode(err);
        // Leave codes first: FORBIDDEN is also an upload code, but here it means the applicant.
        const leaveError = applyLeaveErrorKey(code);
        const fileError = leaveError ? null : fileUploadErrorKey(code);
        toast.error(
          leaveError
            ? t(`errors.apply.${leaveError}`)
            : fileError
              ? tFiles(`errors.${fileError}`, { count: MAX_LEAVE_FILES })
              : t('errors.apply.GENERIC'),
        );
      }
    },
  });

  const handleCancel = () => router.push('/leave');

  const typeOptions = LEAVE_TYPE_VALUES.map((v) => ({ value: v, label: t(`type.${v}`) }));

  return (
    <Can I="create" a="Leave" passThrough>
      {(allowed: boolean) =>
        allowed ? (
          <div className="mx-auto max-w-2xl space-y-6">
            <header className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h1
                  className="text-2xl font-bold tracking-tight"
                  data-testid={instituteLeave.applyTitle}
                >
                  {t('apply.title')}
                </h1>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                data-testid={instituteLeave.applyBackBtn}
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                {t('detail.back')}
              </Button>
            </header>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void form.handleSubmit();
              }}
              noValidate
              className="space-y-6"
            >
              <FieldGroup>
                <form.Field name="userId">
                  {(field) =>
                    applicantMode === 'self' ? (
                      <Field>
                        <FieldLabel>{t('fields.userId')}</FieldLabel>
                        <OwnApplicant />
                      </Field>
                    ) : (
                      <Field>
                        <FieldLabel htmlFor="leave-apply-user-picker">
                          {t('fields.userId')}
                        </FieldLabel>
                        <ApplicantPicker
                          id="leave-apply-user-picker"
                          value={field.state.value || null}
                          onChange={(v) => field.handleChange(v ?? '')}
                          onlyApplicable={applicantMode === 'children'}
                          includeSelf={applicantMode === 'anyone'}
                          testIds={{
                            trigger: instituteLeave.applyUserPicker,
                            input: instituteLeave.applyUserPickerInput,
                            option: instituteLeave.applyUserPickerOption,
                          }}
                        />
                        {applicantMode === 'children' && !field.state.value ? (
                          <PreselectOnlyChild onPick={(v) => field.handleChange(v)} />
                        ) : null}
                        {/* The picker cannot be "touched" without choosing someone, so the message
                            follows the form: otherwise the disabled Submit goes unexplained. */}
                        <form.Subscribe selector={(state) => state.isTouched}>
                          {(formTouched) =>
                            (field.state.meta.isTouched || formTouched) &&
                            field.state.meta.errors.length > 0 ? (
                              <FieldError
                                errors={collectMessages(field.state.meta.errors).map((m) => ({
                                  message: m,
                                }))}
                              />
                            ) : null
                          }
                        </form.Subscribe>
                      </Field>
                    )
                  }
                </form.Field>

                <form.AppField name="type">
                  {(field) => (
                    <field.SelectField
                      label={t('fields.type')}
                      options={typeOptions}
                      placeholder={t('fields.type')}
                      testId="leave-apply-type-select"
                    />
                  )}
                </form.AppField>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <form.AppField name="startDate">
                    {(field) => (
                      <field.DateField
                        label={t('fields.startDate')}
                        testId="leave-apply-start-date"
                      />
                    )}
                  </form.AppField>
                  <form.AppField name="endDate">
                    {(field) => (
                      <field.DateField label={t('fields.endDate')} testId="leave-apply-end-date" />
                    )}
                  </form.AppField>
                </div>

                <form.AppField name="reason">
                  {(field) => (
                    <field.TextareaField
                      label={t('fields.reason')}
                      maxLength={REASON_MAX}
                      rows={4}
                      testId="leave-apply-reason"
                    />
                  )}
                </form.AppField>

                <form.Field name="fileIds">
                  {(field) => (
                    <FileUpload
                      name="leave-apply"
                      purpose="LEAVE_ATTACHMENT"
                      label={t('fields.files')}
                      description={t('fields.filesHint')}
                      maxFiles={MAX_LEAVE_FILES}
                      onChange={(fileIds) => field.handleChange(fileIds)}
                      onBusyChange={setUploading}
                      // Not gated on "touched": nothing but a rule about the dates makes this
                      // field invalid, and without the message the disabled Submit is unexplained.
                      error={collectMessages(field.state.meta.errors)[0]}
                    />
                  )}
                </form.Field>
              </FieldGroup>

              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCancel}
                  data-testid={instituteLeave.applyCancelBtn}
                >
                  {t('detail.back')}
                </Button>
                <form.AppForm>
                  <form.SubmitButton
                    testId="leave-apply-submit-btn"
                    submittingLabel={t('apply.submitting')}
                    disabled={uploading}
                  >
                    {t('apply.cta')}
                  </form.SubmitButton>
                </form.AppForm>
              </div>
            </form>
          </div>
        ) : (
          <div className="flex items-center justify-center min-h-[400px]">
            <p className="text-muted-foreground" data-testid={instituteLeave.applyAccessDenied}>
              {t('apply.accessDenied')}
            </p>
          </div>
        )
      }
    </Can>
  );
}

function OwnApplicant() {
  const t = useTranslations('leave');
  const ownName = useOwnName(false);
  return (
    <p className="text-sm font-medium" data-testid={instituteLeave.applyApplicantSelf}>
      {ownName ?? t('picker.self')}
    </p>
  );
}

/** With a single linked child there is nothing to choose. */
function PreselectOnlyChild({ onPick }: { onPick: (membershipId: string) => void }) {
  const { students } = useStudents({ first: 50 });
  const mayApplyFor = useMayApplyFor();
  const children = students.flatMap((stu) =>
    stu.membershipId && mayApplyFor({ id: stu.id, membershipId: stu.membershipId })
      ? [stu.membershipId]
      : [],
  );
  const only = children.length === 1 ? children[0] : null;
  React.useEffect(() => {
    if (only) onPick(only);
  }, [only, onPick]);
  return null;
}

function collectMessages(errors: ReadonlyArray<unknown>): string[] {
  const out: string[] = [];
  for (const err of errors) {
    if (err == null) continue;
    if (typeof err === 'string') {
      if (err.length > 0) out.push(err);
      continue;
    }
    if (typeof err === 'object' && 'message' in err) {
      const msg = (err as { message?: unknown }).message;
      if (typeof msg === 'string' && msg.length > 0) out.push(msg);
    }
  }
  return out;
}
