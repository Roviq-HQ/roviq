'use client';

import {
  BOARD_TYPE_VALUES,
  type BoardType,
  EDUCATION_LEVEL_VALUES,
  type EducationLevel,
  ErrorCode,
  INDIAN_STATE_VALUES,
} from '@roviq/common-types';
import { extractGraphQLErrorCode } from '@roviq/graphql';
import { emptyStringToUndefined, i18nTextSchema, zodValidator } from '@roviq/i18n';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  FieldGroup,
  FieldInfoPopover,
  FieldLabel,
  FieldSeparator,
  I18nField,
  setServerFieldError,
  useAppForm,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useStore } from '@tanstack/react-form';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { useResellerCreateInstituteRequest } from '../use-reseller-institutes';

const { resellerInstitutes } = testIds;
// ─── Constants ───────────────────────────────────────────────────────────────

/** Available institute types on the platform. */
const TYPES = ['SCHOOL', 'COACHING', 'LIBRARY'] as const;

/** Academic structure frameworks (school-only). */
const FRAMEWORKS = ['NEP', 'TRADITIONAL'] as const;

// ─── Schemas ─────────────────────────────────────────────────────────────────

// Field names are the GraphQL InstitutePhoneInput's, so a parsed entry is sent as is.
const phoneEntrySchema = z.object({
  countryCode: z.string().default('+91'),
  number: z.string().regex(/^\d{10}$/, 'Phone number must be exactly 10 digits.'),
  isPrimary: z.boolean().default(false),
  isWhatsappEnabled: z.boolean().default(false),
  label: z.string().max(50).default(''),
});

type CreateT = ReturnType<typeof useTranslations<'resellerInstitutes.create'>>;

function buildSchema(t: CreateT) {
  return z.object({
    name: i18nTextSchema,
    code: z.string().min(1, 'Code is required.').max(50),
    type: z.enum(TYPES),
    structureFramework: z.enum(FRAMEWORKS).optional(),
    board: emptyStringToUndefined(z.enum(BOARD_TYPE_VALUES).optional()),
    departments: z.array(z.enum(EDUCATION_LEVEL_VALUES)).default([]),
    group: emptyStringToUndefined(z.string().optional()),
    phones: z.array(phoneEntrySchema),
    addressLine1: emptyStringToUndefined(z.string().optional()),
    city: emptyStringToUndefined(z.string().optional()),
    district: emptyStringToUndefined(z.string().optional()),
    state: emptyStringToUndefined(z.string().optional()),
    postalCode: emptyStringToUndefined(z.string().optional()),
    firstAdmin: z.object({
      firstName: z.string().trim().min(1, t('firstAdmin.firstNameRequired')),
      lastName: emptyStringToUndefined(z.string().trim().optional()),
      email: z.string().trim().email(t('firstAdmin.emailInvalid')),
      phone: emptyStringToUndefined(
        z
          .string()
          .regex(/^\d{10}$/, t('firstAdmin.phoneInvalid'))
          .optional(),
      ),
    }),
  });
}

type FormValues = z.input<ReturnType<typeof buildSchema>>;

const DEFAULT_PHONE: z.input<typeof phoneEntrySchema> = {
  countryCode: '+91',
  number: '',
  isPrimary: true,
  isWhatsappEnabled: true,
  label: '',
};

// ─── Page Component ──────────────────────────────────────────────────────────

/** Server errors that belong to one form field. */
function fieldErrorFor(code: string | null) {
  switch (code) {
    // The slug is derived from the code, so a taken slug is a taken code too.
    case ErrorCode.INSTITUTE_CODE_DUPLICATE:
    case ErrorCode.SLUG_DUPLICATE:
      return { field: 'code', messageKey: 'codeDuplicate' } as const;
    case ErrorCode.INSTITUTE_ADMIN_UNAVAILABLE:
      // One message for every reason; the server never says which detail is the problem.
      return { field: 'firstAdmin.email', messageKey: 'firstAdmin.unavailable' } as const;
    default:
      return null;
  }
}

export default function ResellerCreateInstitutePage() {
  const t = useTranslations('resellerInstitutes.create');
  const tGeo = useTranslations('geography');
  const router = useRouter();
  const [createRequest] = useResellerCreateInstituteRequest();
  const schema = useMemo(() => buildSchema(t), [t]);

  const form = useAppForm({
    defaultValues: {
      name: { en: '' },
      code: '',
      type: 'SCHOOL',
      structureFramework: 'TRADITIONAL',
      board: 'CBSE',
      departments: [],
      group: '',
      phones: [{ ...DEFAULT_PHONE }],
      addressLine1: '',
      city: '',
      district: '',
      state: '',
      postalCode: '',
      firstAdmin: { firstName: '', lastName: '', email: '', phone: '' },
    } satisfies FormValues,
    validators: { onChange: zodValidator(schema), onSubmit: zodValidator(schema) },
    onSubmit: async ({ value }) => {
      const parsed = schema.parse(value);
      const slug = parsed.code
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      const filteredPhones = parsed.phones.filter((p) => p.number);
      const contact =
        filteredPhones.length > 0 ? { phones: filteredPhones, emails: [] } : undefined;

      const address = parsed.addressLine1
        ? {
            line1: parsed.addressLine1,
            line2: '',
            line3: '',
            city: parsed.city ?? '',
            district: parsed.district ?? '',
            state: parsed.state ?? '',
            postalCode: parsed.postalCode ?? '',
            country: 'IN',
          }
        : undefined;

      const isSchoolType = parsed.type === 'SCHOOL';

      try {
        await createRequest({
          variables: {
            input: {
              name: parsed.name,
              code: parsed.code,
              slug,
              type: parsed.type,
              structureFramework: isSchoolType ? parsed.structureFramework : undefined,
              board: isSchoolType ? parsed.board : undefined,
              departments: isSchoolType ? parsed.departments : undefined,
              contact,
              address,
              firstAdmin: parsed.firstAdmin,
            },
          },
        });
        toast.success(t('success'));
        router.push('/reseller/institutes');
      } catch (err) {
        const code = extractGraphQLErrorCode(err);
        const fieldError = fieldErrorFor(code);
        if (fieldError) {
          const message = t(fieldError.messageKey);
          setServerFieldError(form, fieldError.field, message);
          toast.error(message);
        } else {
          toast.error(t('error'), { description: errorDescription(code) });
        }
      }
    },
  });

  // Cascading: selectively render school-only sections off the live `type`.
  const instituteType = useStore(form.store, (s) => (s.values as FormValues).type);
  const isSchool = instituteType === 'SCHOOL';
  const selectedDepartments = useStore(
    form.store,
    (s) => (s.values as FormValues).departments ?? [],
  );

  function errorDescription(code: string | null): string | undefined {
    if (code === ErrorCode.BAD_REQUEST) return t('errors.invalidInput');
    if (code === ErrorCode.INSTITUTE_GROUP_NOT_FOUND) return t('errors.groupNotFound');
    if (code === ErrorCode.FORBIDDEN) return t('errors.forbidden');
    return undefined;
  }

  function toggleDepartment(dept: EducationLevel) {
    const current = (form.state.values as FormValues).departments ?? [];
    const updated = current.includes(dept) ? current.filter((d) => d !== dept) : [...current, dept];
    // TanStack's `setFieldValue` typed name union elides `string[]`-typed
    // fields whose schema uses `.default([])` — `departments` resolves to
    // `string[] | undefined` at the input layer and is filtered out of the
    // generated DeepKeys set. The runtime call is correct; the suppression
    // applies only to the field-name overload, not the value type.
    // @ts-expect-error — see comment above; remove if upstream tightens DeepKeys.
    form.setFieldValue('departments', updated);
  }

  const typeOptions = TYPES.map((tp) => ({ value: tp, label: tp }));
  const frameworkOptions = FRAMEWORKS.map((fw) => ({ value: fw, label: t(`frameworks.${fw}`) }));
  const boardOptions = BOARD_TYPE_VALUES.map((b: BoardType) => ({
    value: b,
    label: t(`boards.${b}`),
  }));
  const stateOptions = INDIAN_STATE_VALUES.map((s) => ({
    value: s,
    label: tGeo(`states.${s}`),
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <FieldGroup>
              {/* ─── Identity ──────────────────────────────────────────── */}

              <I18nField
                form={form}
                name="name"
                label={t('name')}
                placeholder={t('namePlaceholder')}
              />

              <form.AppField name="code">
                {(field) => (
                  <field.TextField
                    label={t('code')}
                    description={t('codeDescription')}
                    placeholder={t('codePlaceholder')}
                    info={
                      <FieldInfoPopover
                        title={t('fieldHelp.codeTitle')}
                        data-testid={resellerInstitutes.newCodeInfo}
                      >
                        <p>{t('fieldHelp.codeBody')}</p>
                        <p>
                          <em>{t('fieldHelp.codeExample')}</em>
                        </p>
                      </FieldInfoPopover>
                    }
                  />
                )}
              </form.AppField>

              <form.AppField name="type">
                {(field) => (
                  <field.SelectField
                    label={t('type')}
                    options={typeOptions}
                    placeholder={t('typePlaceholder')}
                    optional={false}
                    info={
                      <FieldInfoPopover
                        title={t('fieldHelp.typeTitle')}
                        data-testid={resellerInstitutes.newTypeInfo}
                      >
                        <p>{t('fieldHelp.typeBody')}</p>
                      </FieldInfoPopover>
                    }
                  />
                )}
              </form.AppField>

              {/* ─── School-specific fields ────────────────────────────── */}

              {isSchool && (
                <>
                  <form.AppField name="structureFramework">
                    {(field) => (
                      <field.SelectField
                        label={t('structureFramework')}
                        description={t('structureFrameworkDescription')}
                        options={frameworkOptions}
                        optional={false}
                        info={
                          <FieldInfoPopover
                            title={t('fieldHelp.structureFrameworkTitle')}
                            data-testid={resellerInstitutes.newFrameworkInfo}
                          >
                            <p>{t('fieldHelp.structureFrameworkBody')}</p>
                          </FieldInfoPopover>
                        }
                      />
                    )}
                  </form.AppField>

                  <form.AppField name="board">
                    {(field) => (
                      <field.SelectField
                        label={t('board')}
                        options={boardOptions}
                        placeholder={t('boardPlaceholder')}
                        info={
                          <FieldInfoPopover
                            title={t('fieldHelp.boardTitle')}
                            data-testid={resellerInstitutes.newBoardInfo}
                          >
                            <p>{t('fieldHelp.boardBody')}</p>
                          </FieldInfoPopover>
                        }
                      />
                    )}
                  </form.AppField>

                  <Field>
                    <FieldLabel>{t('departments')}</FieldLabel>
                    <div className="flex flex-wrap gap-3">
                      {EDUCATION_LEVEL_VALUES.map((dept) => (
                        <div key={dept} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            id={`dept-${dept}`}
                            checked={selectedDepartments.includes(dept)}
                            onCheckedChange={() => toggleDepartment(dept)}
                          />
                          <FieldLabel
                            htmlFor={`dept-${dept}`}
                            className="cursor-pointer font-normal"
                          >
                            {t(`departmentOptions.${dept}`)}
                          </FieldLabel>
                        </div>
                      ))}
                    </div>
                  </Field>
                </>
              )}

              {/* ─── Group ──────────────────────────────────────────────── */}

              <form.AppField name="group">
                {(field) => (
                  <field.TextField
                    label={t('group')}
                    description={t('groupDescription')}
                    placeholder={t('groupPlaceholder')}
                    info={
                      <FieldInfoPopover
                        title={t('fieldHelp.groupTitle')}
                        data-testid={resellerInstitutes.newGroupInfo}
                      >
                        <p>{t('fieldHelp.groupBody')}</p>
                      </FieldInfoPopover>
                    }
                  />
                )}
              </form.AppField>

              {/* ─── Contact ───────────────────────────────────────────── */}

              {/* ─── First admin ───────────────────────────────────────── */}

              <FieldSeparator>{t('firstAdmin.title')}</FieldSeparator>
              <p className="text-sm text-muted-foreground">
                {t('firstAdmin.description')}
                <FieldInfoPopover
                  title={t('firstAdmin.infoTitle')}
                  data-testid={resellerInstitutes.newFirstAdminInfo}
                >
                  <p>{t('firstAdmin.infoBody')}</p>
                </FieldInfoPopover>
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <form.AppField name="firstAdmin.firstName">
                  {(field) => (
                    <field.TextField
                      label={t('firstAdmin.firstName')}
                      testId={resellerInstitutes.newFirstAdminFirstName}
                    />
                  )}
                </form.AppField>
                <form.AppField name="firstAdmin.lastName">
                  {(field) => (
                    <field.TextField
                      label={t('firstAdmin.lastName')}
                      testId={resellerInstitutes.newFirstAdminLastName}
                    />
                  )}
                </form.AppField>
              </div>
              <form.AppField name="firstAdmin.email">
                {(field) => (
                  <field.TextField
                    label={t('firstAdmin.email')}
                    placeholder={t('firstAdmin.emailPlaceholder')}
                    type="email"
                    testId={resellerInstitutes.newFirstAdminEmail}
                  />
                )}
              </form.AppField>
              <form.AppField name="firstAdmin.phone">
                {(field) => (
                  <field.TextField
                    label={t('firstAdmin.phone')}
                    placeholder={t('firstAdmin.phonePlaceholder')}
                    inputMode="numeric"
                    testId={resellerInstitutes.newFirstAdminPhone}
                  />
                )}
              </form.AppField>

              <FieldSeparator>{t('contact')}</FieldSeparator>

              <form.Field name="phones" mode="array">
                {(phonesField) => (
                  <>
                    {phonesField.state.value.map((_, index) => (
                      <div
                        // biome-ignore lint/suspicious/noArrayIndexKey: phones array reorders only via add/remove; index is stable for this UX.
                        key={index}
                        className="grid grid-cols-[70px_1fr_auto] items-end gap-2 rounded-lg border p-3"
                      >
                        <form.AppField name={`phones[${index}].countryCode` as const}>
                          {(field) => <field.TextField label={t('countryCode')} disabled />}
                        </form.AppField>
                        <form.AppField name={`phones[${index}].number` as const}>
                          {(field) => (
                            <field.TextField
                              label={t('phoneNumber')}
                              placeholder={t('phonePlaceholder')}
                              inputMode="numeric"
                              maxLength={10}
                            />
                          )}
                        </form.AppField>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => phonesField.removeValue(index)}
                          disabled={phonesField.state.value.length <= 1}
                        >
                          {t('removePhone')}
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        phonesField.pushValue({
                          ...DEFAULT_PHONE,
                          isPrimary: false,
                          isWhatsappEnabled: false,
                        })
                      }
                    >
                      {t('addPhone')}
                    </Button>
                  </>
                )}
              </form.Field>

              {/* ─── Address ───────────────────────────────────────────── */}

              <FieldSeparator>{t('address')}</FieldSeparator>

              <form.AppField name="addressLine1">
                {(field) => (
                  <field.TextField label={t('line1')} placeholder={t('line1Placeholder')} />
                )}
              </form.AppField>

              <div className="grid grid-cols-2 gap-4">
                <form.AppField name="city">
                  {(field) => (
                    <field.TextField label={t('city')} placeholder={t('cityPlaceholder')} />
                  )}
                </form.AppField>
                <form.AppField name="district">
                  {(field) => (
                    <field.TextField label={t('district')} placeholder={t('districtPlaceholder')} />
                  )}
                </form.AppField>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <form.AppField name="state">
                  {(field) => (
                    <field.SelectField
                      label={t('state')}
                      options={stateOptions}
                      placeholder={t('statePlaceholder')}
                    />
                  )}
                </form.AppField>
                <form.AppField name="postalCode">
                  {(field) => (
                    <field.TextField
                      label={t('postalCode')}
                      placeholder={t('postalCodePlaceholder')}
                      inputMode="numeric"
                      maxLength={6}
                    />
                  )}
                </form.AppField>
              </div>
            </FieldGroup>

            <div className="mt-6 flex justify-end">
              <form.AppForm>
                <form.SubmitButton submittingLabel={t('submitting')}>
                  {t('submit')}
                </form.SubmitButton>
              </form.AppForm>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
