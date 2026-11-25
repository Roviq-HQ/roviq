'use client';

import { zodValidator } from '@roviq/i18n';
import {
  Can,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLabelWithInfo,
  Skeleton,
  useAppForm,
} from '@roviq/ui';
import { useStore } from '@tanstack/react-form';
import { instituteBrandingHelp } from '@web/help/institute-settings/institute-branding.help';
import { useErrorCopy } from '@web/hooks/use-error-copy';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { applyTenantTheme } from '../../tenant-theme-provider';
import { BrandingImageField, type BrandingImageValue } from './components/branding-image-field';
import { BrandingPreview } from './components/branding-preview';
import { type InstituteBrandingFormValues, instituteBrandingSchema } from './schemas';
import type { MyInstituteData } from './types';
import { useUpdateInstituteBranding } from './use-institute-settings';

const { instituteSettings } = testIds;
const THEME_OPTIONS = ['default', 'classic', 'modern', 'minimal'] as const;

interface InstituteBrandingTabProps {
  institute: MyInstituteData['myInstitute'] | undefined;
  loading: boolean;
}

type ImageField = 'logoFileId' | 'faviconFileId' | 'coverImageFileId';

const DEFAULT_VALUES: InstituteBrandingFormValues = {
  logoFileId: undefined,
  faviconFileId: undefined,
  primaryColor: '#1e40af',
  secondaryColor: '#e2e8f0',
  themeIdentifier: 'default',
  coverImageFileId: undefined,
};

export function InstituteBrandingTab({ institute, loading }: InstituteBrandingTabProps) {
  const t = useTranslations('instituteSettings');
  const errorCopy = useErrorCopy();
  const tb = useTranslations('instituteSettings.branding');
  const [updateBranding] = useUpdateInstituteBranding();
  const [uploading, setUploading] = React.useState<Record<string, boolean>>({});
  // Local link to a newly picked logo, for the preview only.
  const [pickedLogoUrl, setPickedLogoUrl] = React.useState<string | null>(null);
  const [round, setRound] = React.useState(0);

  const branding = institute?.branding;

  const form = useAppForm({
    defaultValues: DEFAULT_VALUES,
    validators: {
      onChange: zodValidator(instituteBrandingSchema),
      onSubmit: zodValidator(instituteBrandingSchema),
    },
    onSubmit: async ({ value }) => {
      try {
        await updateBranding({
          variables: {
            input: {
              logoFileId: value.logoFileId,
              faviconFileId: value.faviconFileId,
              primaryColor: value.primaryColor || undefined,
              secondaryColor: value.secondaryColor || undefined,
              themeIdentifier: value.themeIdentifier || undefined,
              coverImageFileId: value.coverImageFileId,
            },
          },
        });
        toast.success(t('saved'));
        setRound((current) => current + 1);
      } catch (err) {
        toast.error(errorCopy(err, t('saveFailed')));
      }
    },
  });

  const isDirty = useStore(form.store, (state) => state.isDirty);
  const primaryColor = useStore(
    form.store,
    (state) => (state.values as InstituteBrandingFormValues).primaryColor || '#1e40af',
  );
  const secondaryColor = useStore(
    form.store,
    (state) => (state.values as InstituteBrandingFormValues).secondaryColor || '#e2e8f0',
  );

  React.useEffect(() => {
    window.dispatchEvent(new CustomEvent('institute-form-dirty', { detail: { dirty: isDirty } }));
  }, [isDirty]);

  // Live theme preview: paint the picked primary colour as the app accent
  // while editing, then restore the saved colour on unmount so an abandoned
  // edit doesn't leave the preview stuck. Reuses the layout provider's exact
  // injection path (single source of truth).
  const savedPrimary = branding?.primaryColor ?? null;
  React.useEffect(() => {
    applyTenantTheme(primaryColor);
    return () => applyTenantTheme(savedPrimary);
  }, [primaryColor, savedPrimary]);

  React.useEffect(() => {
    if (!branding) return;
    form.reset(
      {
        logoFileId: undefined,
        faviconFileId: undefined,
        primaryColor: branding.primaryColor ?? '#1e40af',
        secondaryColor: branding.secondaryColor ?? '#e2e8f0',
        themeIdentifier: branding.themeIdentifier ?? 'default',
        coverImageFileId: undefined,
      },
      { keepDefaultValues: true },
    );
  }, [branding, form]);

  const logoFileId = useStore(
    form.store,
    (state) => (state.values as InstituteBrandingFormValues).logoFileId,
  );
  const faviconFileId = useStore(
    form.store,
    (state) => (state.values as InstituteBrandingFormValues).faviconFileId,
  );
  const coverImageFileId = useStore(
    form.store,
    (state) => (state.values as InstituteBrandingFormValues).coverImageFileId,
  );

  React.useEffect(() => {
    if (typeof logoFileId !== 'string') setPickedLogoUrl(null);
  }, [logoFileId]);
  React.useEffect(
    () => () => {
      if (pickedLogoUrl) URL.revokeObjectURL(pickedLogoUrl);
    },
    [pickedLogoUrl],
  );

  const setImage = (field: ImageField) => (value: BrandingImageValue, file?: File) => {
    // An unchanged value must not mark the form as edited.
    if (form.getFieldValue(field) === value) return;
    form.setFieldValue(field, value);
    if (field === 'logoFileId' && file) setPickedLogoUrl(URL.createObjectURL(file));
  };
  const setBusy = (field: ImageField) => (busy: boolean) =>
    setUploading((current) => (current[field] === busy ? current : { ...current, [field]: busy }));
  const isUploading = Object.values(uploading).some(Boolean);
  const previewLogoUrl =
    logoFileId === null ? null : (pickedLogoUrl ?? branding?.logo?.url ?? null);

  const themeOptions = THEME_OPTIONS.map((theme) => ({
    value: theme,
    label: tb(`themeOptions.${theme}`),
  }));

  if (loading && !institute) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <Can I="update_branding" a="Institute" passThrough>
      {(allowed: boolean) => (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader>
              <CardTitle>{tb('title')}</CardTitle>
              <CardDescription>{tb('description')}</CardDescription>
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
                <fieldset disabled={!allowed}>
                  <FieldGroup>
                    <BrandingImageField
                      name="logo"
                      purpose="INSTITUTE_LOGO"
                      label={tb('logo')}
                      description={tb('logoDescription')}
                      current={branding?.logo}
                      value={logoFileId}
                      onChange={setImage('logoFileId')}
                      onBusyChange={setBusy('logoFileId')}
                      editable={allowed}
                      round={round}
                    />
                    <BrandingImageField
                      name="favicon"
                      purpose="INSTITUTE_FAVICON"
                      label={tb('favicon')}
                      description={tb('faviconDescription')}
                      current={branding?.favicon}
                      value={faviconFileId}
                      onChange={setImage('faviconFileId')}
                      onBusyChange={setBusy('faviconFileId')}
                      editable={allowed}
                      round={round}
                    />

                    <div className="grid grid-cols-2 gap-4">
                      <Field>
                        <FieldLabelWithInfo help={instituteBrandingHelp.primaryColor}>
                          {tb('primaryColor')}
                        </FieldLabelWithInfo>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={primaryColor}
                            onChange={(e) => form.setFieldValue('primaryColor', e.target.value)}
                            className="h-8 w-10 cursor-pointer rounded border-0"
                            aria-label={tb('primaryColor')}
                            data-testid={instituteSettings.brandingPrimaryColorPicker}
                          />
                          <form.AppField name="primaryColor">
                            {(field) => (
                              <field.TextField
                                label=""
                                placeholder="#1e40af"
                                testId="branding-primary-color-input"
                              />
                            )}
                          </form.AppField>
                        </div>
                        <FieldDescription>{tb('primaryColorDescription')}</FieldDescription>
                      </Field>

                      <Field>
                        <FieldLabel>{tb('secondaryColor')}</FieldLabel>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={secondaryColor}
                            onChange={(e) => form.setFieldValue('secondaryColor', e.target.value)}
                            className="h-8 w-10 cursor-pointer rounded border-0"
                            aria-label={tb('secondaryColor')}
                            data-testid={instituteSettings.brandingSecondaryColorPicker}
                          />
                          <form.AppField name="secondaryColor">
                            {(field) => (
                              <field.TextField
                                label=""
                                placeholder="#e2e8f0"
                                testId="branding-secondary-color-input"
                              />
                            )}
                          </form.AppField>
                        </div>
                        <FieldDescription>{tb('secondaryColorDescription')}</FieldDescription>
                      </Field>
                    </div>

                    <form.AppField name="themeIdentifier">
                      {(field) => (
                        <field.SelectField
                          label={tb('theme')}
                          description={tb('themeDescription')}
                          options={themeOptions}
                          optional={false}
                          testId="branding-theme-select"
                          help={instituteBrandingHelp.theme}
                        />
                      )}
                    </form.AppField>

                    <BrandingImageField
                      name="cover"
                      purpose="INSTITUTE_COVER"
                      label={tb('coverImage')}
                      description={tb('coverImageDescription')}
                      current={branding?.coverImage}
                      value={coverImageFileId}
                      onChange={setImage('coverImageFileId')}
                      onBusyChange={setBusy('coverImageFileId')}
                      editable={allowed}
                      round={round}
                    />
                  </FieldGroup>

                  {allowed && (
                    <div className="mt-6 flex justify-end">
                      <form.AppForm>
                        <form.SubmitButton
                          testId="branding-save-btn"
                          disabled={!isDirty || isUploading}
                          submittingLabel={t('saving')}
                        >
                          {t('save')}
                        </form.SubmitButton>
                      </form.AppForm>
                    </div>
                  )}
                </fieldset>
              </form>
            </CardContent>
          </Card>

          <div className="hidden lg:block">
            <BrandingPreview form={form} logoUrl={previewLogoUrl} />
          </div>

          {!allowed && <p className="text-sm text-muted-foreground">{t('noPermission')}</p>}
        </div>
      )}
    </Can>
  );
}

import { testIds } from '@roviq/ui/testing/testid-registry';
