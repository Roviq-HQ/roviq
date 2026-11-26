'use client';

import { extractGraphQLErrorCode } from '@roviq/graphql';
import { emptyStringToUndefined, phoneSchema, zodValidator } from '@roviq/i18n';
import {
  Button,
  FieldGroup,
  FieldLegend,
  FieldSet,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  setFormSubmitError,
  useAppForm,
} from '@roviq/ui';
import { enquiryHelp } from '@web/help/admission/enquiry.help';
import { useErrorCopy } from '@web/hooks/use-error-copy';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { ENQUIRY_SOURCE_VALUES } from '../admission-constants';
import { admissionErrorKey } from '../admission-errors';
import { useCreateEnquiry } from '../use-admission';

const { instituteAdmissionEnquiries } = testIds;
/** Canonical gender + relationship enums mirroring the backend. */
const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
const RELATIONSHIPS = [
  'FATHER',
  'MOTHER',
  'GRANDPARENT_PATERNAL',
  'GRANDPARENT_MATERNAL',
  'UNCLE',
  'AUNT',
  'SIBLING',
  'LEGAL_GUARDIAN',
  'OTHER',
] as const;

/** Build a Zod schema keyed on translation function so errors localise. */
function buildSchema(t: ReturnType<typeof useTranslations>) {
  return z.object({
    studentName: z
      .string()
      .min(1, t('enquiries.newForm.errors.studentNameRequired'))
      .max(200, t('enquiries.newForm.errors.tooLong', { max: 200 })),
    dateOfBirth: emptyStringToUndefined(z.string().optional()),
    gender: emptyStringToUndefined(z.enum(GENDERS).optional()),
    classRequested: z
      .string()
      .min(1, t('enquiries.newForm.errors.classRequiredRequired'))
      .max(20, t('enquiries.newForm.errors.tooLong', { max: 20 })),
    parentName: z
      .string()
      .min(1, t('enquiries.newForm.errors.parentNameRequired'))
      .max(200, t('enquiries.newForm.errors.tooLong', { max: 200 })),
    parentPhone: phoneSchema(t('enquiries.newForm.errors.parentPhoneInvalid')),
    parentEmail: emptyStringToUndefined(
      z.email({ error: t('enquiries.newForm.errors.emailInvalid') }).optional(),
    ),
    // The admission links this person as a guardian, so the relationship is never guessed.
    parentRelation: z
      .enum(RELATIONSHIPS)
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) {
          ctx.issues.push({
            code: 'custom',
            message: t('enquiries.newForm.errors.parentRelationRequired'),
            input: value,
          });
          return z.NEVER;
        }
        return value;
      }),
    source: emptyStringToUndefined(z.enum(ENQUIRY_SOURCE_VALUES).optional()),
    referredBy: emptyStringToUndefined(
      z
        .string()
        .max(200, t('enquiries.newForm.errors.tooLong', { max: 200 }))
        .optional(),
    ),
    previousSchool: emptyStringToUndefined(
      z
        .string()
        .max(255, t('enquiries.newForm.errors.tooLong', { max: 255 }))
        .optional(),
    ),
    followUpDate: emptyStringToUndefined(z.string().optional()),
    notes: emptyStringToUndefined(
      z
        .string()
        .max(2000, t('enquiries.newForm.errors.tooLong', { max: 2000 }))
        .optional(),
    ),
  });
}

type EnquirySchema = ReturnType<typeof buildSchema>;
type EnquiryFormValues = z.input<EnquirySchema>;

const EMPTY_DEFAULTS: EnquiryFormValues = {
  studentName: '',
  dateOfBirth: '',
  gender: undefined,
  classRequested: '',
  parentName: '',
  parentPhone: '',
  parentEmail: '',
  parentRelation: undefined,
  source: undefined,
  referredBy: '',
  previousSchool: '',
  followUpDate: '',
  notes: '',
};

export interface EnquiryFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (enquiryId: string) => void;
}

/**
 * Slide-over form for creating a new admission enquiry. Implements rule
 * [QIGCL] by defaulting to `side="right"` Sheet — desktop shows as slide-over,
 * mobile falls back to the full-screen sheet variant via viewport styling.
 */
export function EnquiryFormSheet({ open, onOpenChange, onCreated }: EnquiryFormSheetProps) {
  const t = useTranslations('admission');
  const [createEnquiry] = useCreateEnquiry();
  const errorCopy = useErrorCopy();

  const schema = React.useMemo(() => buildSchema(t), [t]);

  const form = useAppForm({
    defaultValues: EMPTY_DEFAULTS,
    validators: { onChange: zodValidator(schema), onSubmit: zodValidator(schema) },
    onSubmit: async ({ value, formApi }) => {
      const parsed = schema.parse(value);
      try {
        const result = await createEnquiry({
          variables: {
            input: {
              studentName: parsed.studentName,
              dateOfBirth: parsed.dateOfBirth,
              gender: parsed.gender,
              classRequested: parsed.classRequested,
              parentName: parsed.parentName,
              parentPhone: parsed.parentPhone.replace(/\D/g, ''),
              parentEmail: parsed.parentEmail,
              parentRelation: parsed.parentRelation,
              source: parsed.source,
              referredBy: parsed.referredBy,
              previousSchool: parsed.previousSchool,
              followUpDate: parsed.followUpDate,
              notes: parsed.notes,
            },
          },
        });
        toast.success(t('enquiries.newForm.success'));
        const id = result.data?.createEnquiry.id;
        onOpenChange(false);
        if (id) onCreated?.(id);
      } catch (err) {
        const key = admissionErrorKey(extractGraphQLErrorCode(err));
        setFormSubmitError(formApi, {
          title: t('enquiries.newForm.errors.generic'),
          // Unlisted codes and a lost connection still get their own translated copy.
          description: key === 'generic' ? errorCopy(err, t('errors.generic')) : t(`errors.${key}`),
        });
      }
    },
  });

  // Reset the form each time the sheet is reopened. If the user closed the
  // sheet mid-edit we don't retain the stale values — that's a deliberate
  // UX trade-off for this lightweight slide-over.
  React.useEffect(() => {
    if (open) {
      form.reset(EMPTY_DEFAULTS);
    }
  }, [open, form]);

  const genderOptions = GENDERS.map((g) => ({ value: g, label: t(`genders.${g}`) }));
  const relationshipOptions = RELATIONSHIPS.map((r) => ({
    value: r,
    label: t(`relationships.${r}`),
  }));
  const sourceOptions = ENQUIRY_SOURCE_VALUES.map((s) => ({ value: s, label: t(`sources.${s}`) }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto" side="right">
        <SheetHeader>
          <SheetTitle data-testid={instituteAdmissionEnquiries.formTitle}>
            {t('enquiries.newForm.title')}
          </SheetTitle>
          <SheetDescription>{t('enquiries.newForm.description')}</SheetDescription>
        </SheetHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
          noValidate
          className="space-y-6 px-4 pb-24"
          data-testid={instituteAdmissionEnquiries.form}
        >
          <FieldSet>
            <FieldLegend>{t('enquiries.newForm.sections.student')}</FieldLegend>
            <FieldGroup>
              <form.AppField name="studentName">
                {(field) => (
                  <field.TextField
                    label={t('enquiries.newForm.fields.studentName')}
                    placeholder={t('enquiries.newForm.placeholders.studentName')}
                    testId="enquiry-student-name-input"
                  />
                )}
              </form.AppField>

              <form.AppField name="dateOfBirth">
                {(field) => (
                  <field.DateField
                    label={t('enquiries.newForm.fields.dateOfBirth')}
                    testId="enquiry-dob-input"
                  />
                )}
              </form.AppField>

              <form.AppField name="gender">
                {(field) => (
                  <field.SelectField
                    label={t('enquiries.newForm.fields.gender')}
                    options={genderOptions}
                    placeholder={t('enquiries.newForm.fields.gender')}
                    testId="enquiry-gender-select"
                  />
                )}
              </form.AppField>

              <form.AppField name="classRequested">
                {(field) => (
                  <field.TextField
                    label={t('enquiries.newForm.fields.classRequested')}
                    placeholder={t('enquiries.newForm.placeholders.classRequested')}
                    description={t('enquiries.newForm.classRequestedLimit')}
                    testId="enquiry-class-input"
                  />
                )}
              </form.AppField>
            </FieldGroup>
          </FieldSet>

          <FieldSet>
            <FieldLegend>{t('enquiries.newForm.sections.parent')}</FieldLegend>
            <FieldGroup>
              <form.AppField name="parentName">
                {(field) => (
                  <field.TextField
                    label={t('enquiries.newForm.fields.parentName')}
                    placeholder={t('enquiries.newForm.placeholders.parentName')}
                    testId="enquiry-parent-name-input"
                  />
                )}
              </form.AppField>

              <form.AppField name="parentPhone">
                {(field) => (
                  <field.PhoneField
                    label={t('enquiries.newForm.fields.parentPhone')}
                    description={t('enquiries.newForm.placeholders.parentPhoneHint')}
                    placeholder={t('enquiries.newForm.placeholders.parentPhone')}
                    testId="enquiry-parent-phone-input"
                  />
                )}
              </form.AppField>

              <form.AppField name="parentEmail">
                {(field) => (
                  <field.TextField
                    label={t('enquiries.newForm.fields.parentEmail')}
                    type="email"
                    placeholder={t('enquiries.newForm.placeholders.parentEmail')}
                    testId="enquiry-parent-email-input"
                  />
                )}
              </form.AppField>

              <form.AppField name="parentRelation">
                {(field) => (
                  <field.SelectField
                    label={t('enquiries.newForm.fields.parentRelation')}
                    options={relationshipOptions}
                    placeholder={t('enquiries.newForm.fields.parentRelation')}
                    optional={false}
                    testId="enquiry-relation-select"
                  />
                )}
              </form.AppField>
            </FieldGroup>
          </FieldSet>

          <FieldSet>
            <FieldLegend>{t('enquiries.newForm.sections.source')}</FieldLegend>
            <FieldGroup>
              <form.AppField name="source">
                {(field) => (
                  <field.SelectField
                    label={t('enquiries.newForm.fields.source')}
                    options={sourceOptions}
                    placeholder={t('enquiries.newForm.fields.source')}
                    testId="enquiry-source-select"
                    help={enquiryHelp.source}
                  />
                )}
              </form.AppField>

              <form.AppField name="referredBy">
                {(field) => (
                  <field.TextField
                    label={t('enquiries.newForm.fields.referredBy')}
                    placeholder={t('enquiries.newForm.placeholders.referredBy')}
                  />
                )}
              </form.AppField>

              <form.AppField name="previousSchool">
                {(field) => (
                  <field.TextField
                    label={t('enquiries.newForm.fields.previousSchool')}
                    placeholder={t('enquiries.newForm.placeholders.previousSchool')}
                  />
                )}
              </form.AppField>

              <form.AppField name="followUpDate">
                {(field) => (
                  <field.DateField
                    label={t('enquiries.newForm.fields.followUpDate')}
                    testId="enquiry-followup-input"
                    help={enquiryHelp.followUpDate}
                  />
                )}
              </form.AppField>

              <form.AppField name="notes">
                {(field) => (
                  <field.TextareaField
                    label={t('enquiries.newForm.fields.notes')}
                    rows={3}
                    placeholder={t('enquiries.newForm.placeholders.notes')}
                  />
                )}
              </form.AppField>
            </FieldGroup>
          </FieldSet>

          <form.AppForm>
            <form.SubmitError />
          </form.AppForm>
          <SheetFooter className="sticky bottom-0 border-t bg-background pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid={instituteAdmissionEnquiries.formCancelBtn}
            >
              {t('enquiries.newForm.cancel')}
            </Button>
            <form.AppForm>
              <form.SubmitButton
                testId="enquiry-form-submit-btn"
                submittingLabel={t('enquiries.newForm.submitting')}
              >
                {t('enquiries.newForm.submit')}
              </form.SubmitButton>
            </form.AppForm>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

import { testIds } from '@roviq/ui/testing/testid-registry';
