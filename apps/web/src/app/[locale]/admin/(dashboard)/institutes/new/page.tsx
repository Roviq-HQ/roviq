'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { extractGraphQLError } from '@roviq/graphql';
import { i18nTextSchema } from '@roviq/i18n';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  FieldSet,
  I18nInput,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@roviq/ui';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { FormProvider, type Resolver, useFieldArray, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useCreateInstitute } from '../use-institutes';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Available institute types on the platform. */
const INSTITUTE_TYPES = ['SCHOOL', 'COACHING', 'LIBRARY'] as const;

/** Academic structure frameworks (school-only). */
const FRAMEWORKS = ['NEP', 'TRADITIONAL'] as const;

/** Education boards (school-only). */
const BOARDS = ['cbse', 'bseh', 'rbse', 'icse'] as const;

/** Academic departments (school-only). */
const DEPARTMENTS = [
  'pre_primary',
  'primary',
  'upper_primary',
  'secondary',
  'senior_secondary',
] as const;

/** Indian states and union territories for the address state dropdown. */
const INDIAN_STATES = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
] as const;

// ─── Schemas ─────────────────────────────────────────────────────────────────

const phoneSchema = z.object({
  country_code: z.string().default('+91'),
  number: z.string().regex(/^\d{10}$/, 'Phone number must be exactly 10 digits.'),
  is_primary: z.boolean().default(false),
  is_whatsapp_enabled: z.boolean().default(false),
  label: z.string().max(50).default(''),
});

const emailSchema = z.object({
  address: z.string().email('Invalid email address.'),
  is_primary: z.boolean().default(false),
  label: z.string().max(50).default(''),
});

const contactSchema = z.object({
  phones: z.array(phoneSchema).default([]),
  emails: z.array(emailSchema).default([]),
});

const addressSchema = z.object({
  line1: z.string().min(1, 'Address line 1 is required.'),
  line2: z.string().optional().default(''),
  line3: z.string().optional().default(''),
  city: z.string().min(1, 'City is required.'),
  district: z.string().min(1, 'District is required.'),
  state: z.string().min(1, 'State is required.'),
  postal_code: z.string().regex(/^\d{6}$/, 'PIN code must be exactly 6 digits.'),
  country: z.string().default('IN'),
  coordinates: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .optional(),
});

const createInstituteSchema = z.object({
  name: i18nTextSchema,
  code: z.string().min(1, 'Code is required.').max(50),
  slug: z.string().optional(),
  type: z.enum(INSTITUTE_TYPES),
  structureFramework: z.enum(FRAMEWORKS).optional(),
  board: z.string().optional(),
  departments: z.array(z.string()).optional(),
  contact: contactSchema.optional(),
  address: addressSchema.optional(),
  reseller: z.string().optional(),
  group: z.string().optional(),
  isDemo: z.boolean().default(false),
});

type CreateInstituteFormValues = z.infer<typeof createInstituteSchema>;

// ─── Page Component ──────────────────────────────────────────────────────────

export default function CreateInstitutePage() {
  const t = useTranslations('adminInstitutes.create');
  const router = useRouter();
  const [createInstitute] = useCreateInstitute();

  const form = useForm<CreateInstituteFormValues>({
    resolver: zodResolver(createInstituteSchema) as Resolver<CreateInstituteFormValues>,
    defaultValues: {
      name: { en: '' },
      code: '',
      type: 'SCHOOL',
      structureFramework: 'TRADITIONAL',
      board: 'cbse',
      departments: [],
      contact: {
        phones: [
          {
            country_code: '+91',
            number: '',
            is_primary: true,
            is_whatsapp_enabled: true,
            label: '',
          },
        ],
        emails: [{ address: '', is_primary: true, label: '' }],
      },
      reseller: '',
      group: '',
      isDemo: false,
    },
  });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = form;

  const instituteType = watch('type');
  const isSchool = instituteType === 'SCHOOL';
  const selectedDepartments = watch('departments') ?? [];

  // ─── Field arrays for contact ────────────────────────────────────────────

  const {
    fields: phoneFields,
    append: appendPhone,
    remove: removePhone,
  } = useFieldArray({ control, name: 'contact.phones' });

  const {
    fields: emailFields,
    append: appendEmail,
    remove: removeEmail,
  } = useFieldArray({ control, name: 'contact.emails' });

  const phones = watch('contact.phones') ?? [];

  function handlePhonePrimaryChange(index: number) {
    phones.forEach((_, i) => {
      setValue(`contact.phones.${i}.is_primary`, i === index, {
        shouldDirty: true,
      });
    });
  }

  function toggleDepartment(dept: string) {
    const current = selectedDepartments;
    const updated = current.includes(dept) ? current.filter((d) => d !== dept) : [...current, dept];
    setValue('departments', updated, { shouldDirty: true });
  }

  // ─── Submit ──────────────────────────────────────────────────────────────

  const onSubmit = async (values: CreateInstituteFormValues) => {
    const slug = values.code
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    try {
      const result = await createInstitute({
        variables: {
          input: {
            name: values.name,
            code: values.code,
            slug,
            type: values.type,
            structureFramework: isSchool ? values.structureFramework : undefined,
            board: isSchool ? values.board : undefined,
            departments: isSchool ? values.departments : undefined,
            contact: values.contact,
            address: values.address,
            isDemo: values.isDemo,
          },
        },
      });
      toast.success(t('success'));
      const id = result.data?.createInstitute.id;
      if (id) router.push(`/admin/institutes/${id}`);
    } catch (err) {
      const message = extractGraphQLError(err, t('error'));
      if (message.includes('INSTITUTE_CODE_DUPLICATE') || message.includes('already exists')) {
        setError('code', { message: t('codeDuplicate') });
      } else if (message.includes('RESELLER_INVALID')) {
        toast.error(t('resellerInvalid'));
      } else {
        toast.error(t('error'), { description: message });
      }
    }
  };

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
          <FormProvider {...form}>
            <form onSubmit={handleSubmit(onSubmit)}>
              <FieldGroup>
                {/* ─── Identity ──────────────────────────────────────────── */}

                <I18nInput<CreateInstituteFormValues>
                  name="name"
                  label={t('name')}
                  required
                  placeholder={t('namePlaceholder')}
                />

                <Field data-invalid={!!errors.code}>
                  <FieldLabel htmlFor="code">{t('code')}</FieldLabel>
                  <FieldDescription>{t('codeDescription')}</FieldDescription>
                  <Input
                    id="code"
                    {...register('code')}
                    placeholder={t('codePlaceholder')}
                    aria-invalid={!!errors.code}
                  />
                  {errors.code && <FieldError errors={[errors.code]} />}
                </Field>

                <Field>
                  <FieldLabel>{t('type')}</FieldLabel>
                  <Select
                    value={instituteType}
                    onValueChange={(v) =>
                      setValue('type', v as CreateInstituteFormValues['type'], {
                        shouldDirty: true,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('typePlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {INSTITUTE_TYPES.map((tp) => (
                        <SelectItem key={tp} value={tp}>
                          {t(`../types.${tp}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                {/* ─── School-specific fields ────────────────────────────── */}

                {isSchool && (
                  <>
                    <Field>
                      <FieldLabel>{t('structureFramework')}</FieldLabel>
                      <FieldDescription>{t('structureFrameworkDescription')}</FieldDescription>
                      <Select
                        value={watch('structureFramework') ?? 'TRADITIONAL'}
                        onValueChange={(v) =>
                          setValue('structureFramework', v as 'NEP' | 'TRADITIONAL', {
                            shouldDirty: true,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FRAMEWORKS.map((fw) => (
                            <SelectItem key={fw} value={fw}>
                              {t(`frameworks.${fw}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>

                    <Field>
                      <FieldLabel>{t('board')}</FieldLabel>
                      <Select
                        value={watch('board') ?? 'cbse'}
                        onValueChange={(v) => setValue('board', v, { shouldDirty: true })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t('boardPlaceholder')} />
                        </SelectTrigger>
                        <SelectContent>
                          {BOARDS.map((b) => (
                            <SelectItem key={b} value={b}>
                              {t(`boards.${b}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>

                    <Field>
                      <FieldLabel>{t('departments')}</FieldLabel>
                      <FieldDescription>{t('departmentsDescription')}</FieldDescription>
                      <div className="flex flex-wrap gap-3">
                        {DEPARTMENTS.map((dept) => (
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

                {/* ─── Reseller & Group ──────────────────────────────────── */}

                <FieldSeparator />

                <Field>
                  <FieldLabel htmlFor="reseller">{t('reseller')}</FieldLabel>
                  <FieldDescription>{t('resellerDescription')}</FieldDescription>
                  <Input id="reseller" {...register('reseller')} placeholder={t('roviqDirect')} />
                </Field>

                <Field>
                  <FieldLabel htmlFor="group">{t('group')}</FieldLabel>
                  <FieldDescription>{t('groupDescription')}</FieldDescription>
                  <Input id="group" {...register('group')} placeholder={t('groupPlaceholder')} />
                </Field>

                {/* ─── Contact Details (phones) ─────────────────────────── */}

                <FieldSeparator>{t('contact')}</FieldSeparator>

                <FieldSet>
                  <FieldLabel>{t('phones')}</FieldLabel>
                  {errors.contact?.phones?.root && (
                    <FieldError errors={[errors.contact.phones.root]} />
                  )}
                  {errors.contact?.phones && typeof errors.contact.phones.message === 'string' && (
                    <FieldError errors={[errors.contact.phones as { message: string }]} />
                  )}

                  <div className="space-y-3">
                    {phoneFields.map((field, index) => (
                      <div
                        key={field.id}
                        className="grid grid-cols-[80px_1fr_auto_auto_1fr_auto] items-end gap-2 rounded-lg border p-3"
                      >
                        <Field>
                          <FieldLabel className="text-xs">{t('countryCode')}</FieldLabel>
                          <Input
                            {...register(`contact.phones.${index}.country_code`)}
                            className="text-center"
                            readOnly
                          />
                        </Field>

                        <Field data-invalid={!!errors.contact?.phones?.[index]?.number}>
                          <FieldLabel className="text-xs">{t('phoneNumber')}</FieldLabel>
                          <Input
                            {...register(`contact.phones.${index}.number`)}
                            placeholder={t('phonePlaceholder')}
                            inputMode="numeric"
                            maxLength={10}
                            aria-invalid={!!errors.contact?.phones?.[index]?.number}
                          />
                          {errors.contact?.phones?.[index]?.number && (
                            <FieldError errors={[errors.contact.phones[index].number]} />
                          )}
                        </Field>

                        <Field>
                          <FieldLabel className="text-xs">{t('isPrimary')}</FieldLabel>
                          <div className="flex h-8 items-center">
                            <Checkbox
                              checked={phones[index]?.is_primary ?? false}
                              onCheckedChange={() => handlePhonePrimaryChange(index)}
                            />
                          </div>
                        </Field>

                        <Field>
                          <FieldLabel className="text-xs">{t('isWhatsappEnabled')}</FieldLabel>
                          <div className="flex h-8 items-center">
                            <Switch
                              checked={phones[index]?.is_whatsapp_enabled ?? false}
                              onCheckedChange={(v) =>
                                setValue(`contact.phones.${index}.is_whatsapp_enabled`, v, {
                                  shouldDirty: true,
                                })
                              }
                            />
                          </div>
                        </Field>

                        <Field>
                          <FieldLabel className="text-xs">{t('phoneLabel')}</FieldLabel>
                          <Input
                            {...register(`contact.phones.${index}.label`)}
                            placeholder={t('phoneLabelPlaceholder')}
                          />
                        </Field>

                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removePhone(index)}
                          aria-label={t('removePhone')}
                          disabled={phoneFields.length <= 1}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ))}
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      appendPhone({
                        country_code: '+91',
                        number: '',
                        is_primary: phoneFields.length === 0,
                        is_whatsapp_enabled: phoneFields.length === 0,
                        label: '',
                      })
                    }
                  >
                    <Plus className="size-4" />
                    {t('addPhone')}
                  </Button>
                </FieldSet>

                {/* ─── Contact Details (emails) ─────────────────────────── */}

                <FieldSet>
                  <FieldLabel>{t('emails')}</FieldLabel>

                  <div className="space-y-3">
                    {emailFields.map((field, index) => (
                      <div
                        key={field.id}
                        className="grid grid-cols-[1fr_auto_1fr_auto] items-end gap-2 rounded-lg border p-3"
                      >
                        <Field data-invalid={!!errors.contact?.emails?.[index]?.address}>
                          <FieldLabel className="text-xs">{t('emailAddress')}</FieldLabel>
                          <Input
                            {...register(`contact.emails.${index}.address`)}
                            type="email"
                            placeholder={t('emailPlaceholder')}
                            aria-invalid={!!errors.contact?.emails?.[index]?.address}
                          />
                          {errors.contact?.emails?.[index]?.address && (
                            <FieldError errors={[errors.contact.emails[index].address]} />
                          )}
                        </Field>

                        <Field>
                          <FieldLabel className="text-xs">{t('emailIsPrimary')}</FieldLabel>
                          <div className="flex h-8 items-center">
                            <Checkbox
                              checked={watch(`contact.emails.${index}.is_primary`)}
                              onCheckedChange={(v) =>
                                setValue(`contact.emails.${index}.is_primary`, !!v, {
                                  shouldDirty: true,
                                })
                              }
                            />
                          </div>
                        </Field>

                        <Field>
                          <FieldLabel className="text-xs">{t('emailLabel')}</FieldLabel>
                          <Input
                            {...register(`contact.emails.${index}.label`)}
                            placeholder={t('emailLabelPlaceholder')}
                          />
                        </Field>

                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removeEmail(index)}
                          aria-label={t('removeEmail')}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ))}
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => appendEmail({ address: '', is_primary: false, label: '' })}
                  >
                    <Plus className="size-4" />
                    {t('addEmail')}
                  </Button>
                </FieldSet>

                {/* ─── Address ───────────────────────────────────────────── */}

                <FieldSeparator>{t('address')}</FieldSeparator>

                <Field data-invalid={!!errors.address?.line1}>
                  <FieldLabel htmlFor="address-line1">{t('line1')}</FieldLabel>
                  <Input
                    id="address-line1"
                    {...register('address.line1')}
                    placeholder={t('line1Placeholder')}
                    aria-invalid={!!errors.address?.line1}
                  />
                  {errors.address?.line1 && <FieldError errors={[errors.address.line1]} />}
                </Field>

                <Field>
                  <FieldLabel htmlFor="address-line2">{t('line2')}</FieldLabel>
                  <Input
                    id="address-line2"
                    {...register('address.line2')}
                    placeholder={t('line2Placeholder')}
                  />
                </Field>

                <div className="grid grid-cols-2 gap-4">
                  <Field data-invalid={!!errors.address?.city}>
                    <FieldLabel htmlFor="address-city">{t('city')}</FieldLabel>
                    <Input
                      id="address-city"
                      {...register('address.city')}
                      placeholder={t('cityPlaceholder')}
                      aria-invalid={!!errors.address?.city}
                    />
                    {errors.address?.city && <FieldError errors={[errors.address.city]} />}
                  </Field>

                  <Field data-invalid={!!errors.address?.district}>
                    <FieldLabel htmlFor="address-district">{t('district')}</FieldLabel>
                    <Input
                      id="address-district"
                      {...register('address.district')}
                      placeholder={t('districtPlaceholder')}
                      aria-invalid={!!errors.address?.district}
                    />
                    {errors.address?.district && <FieldError errors={[errors.address.district]} />}
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Field data-invalid={!!errors.address?.state}>
                    <FieldLabel>{t('state')}</FieldLabel>
                    <Select
                      value={watch('address.state') ?? ''}
                      onValueChange={(v) => setValue('address.state', v, { shouldDirty: true })}
                    >
                      <SelectTrigger aria-invalid={!!errors.address?.state}>
                        <SelectValue placeholder={t('statePlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {INDIAN_STATES.map((state) => (
                          <SelectItem key={state} value={state}>
                            {state}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {errors.address?.state && <FieldError errors={[errors.address.state]} />}
                  </Field>

                  <Field data-invalid={!!errors.address?.postal_code}>
                    <FieldLabel htmlFor="address-postal-code">{t('postalCode')}</FieldLabel>
                    <Input
                      id="address-postal-code"
                      {...register('address.postal_code')}
                      placeholder={t('postalCodePlaceholder')}
                      inputMode="numeric"
                      maxLength={6}
                      aria-invalid={!!errors.address?.postal_code}
                    />
                    {errors.address?.postal_code && (
                      <FieldError errors={[errors.address.postal_code]} />
                    )}
                  </Field>
                </div>

                {/* ─── Demo toggle ───────────────────────────────────────── */}

                <FieldSeparator />

                <Field>
                  <div className="flex items-center justify-between">
                    <div>
                      <FieldLabel>{t('isDemo')}</FieldLabel>
                      <FieldDescription>{t('isDemoDescription')}</FieldDescription>
                    </div>
                    <Switch
                      checked={watch('isDemo')}
                      onCheckedChange={(v) => setValue('isDemo', v, { shouldDirty: true })}
                    />
                  </div>
                </Field>
              </FieldGroup>

              <div className="mt-6 flex justify-end">
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      {t('creating')}
                    </>
                  ) : (
                    t('submit')
                  )}
                </Button>
              </div>
            </form>
          </FormProvider>
        </CardContent>
      </Card>
    </div>
  );
}
