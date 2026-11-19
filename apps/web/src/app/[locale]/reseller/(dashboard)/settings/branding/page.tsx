'use client';

import {
  RESELLER_BRAND_COLOR_RE,
  RESELLER_BRANDING_THEME_VALUES,
  RESELLER_CUSTOM_CSS_MAX_LENGTH,
} from '@roviq/common-types';
import { extractGraphQLErrorCode } from '@roviq/graphql';
import { zodValidator } from '@roviq/i18n';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldInfoPopover,
  FieldLabel,
  useAbility,
  useAppForm,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useStore } from '@tanstack/react-form';
import { fileUploadErrorKey } from '@web/components/file-upload/use-file-upload';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { BrandingImageField, type ImageChange } from '../_components/branding-image-field';
import { BrandingPreview } from '../_components/branding-preview';
import {
  ReadOnlyNotice,
  SettingsLoadError,
  SettingsLoading,
  useUnsavedChangesWarning,
} from '../_components/settings-states';
import {
  createResellerBrandingSchema,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
  type ResellerBrandingFormValues,
} from '../schemas';
import {
  type ResellerProfile,
  useResellerProfile,
  useSettingsErrorMessage,
  useUpdateResellerBranding,
} from '../use-reseller-settings';

const { resellerSettings } = testIds;
// Code, not copy: braces would also be read as an ICU argument in a message.
const CUSTOM_CSS_SAMPLE = '.brand-header { letter-spacing: 0.02em; }';

function toFormValues(profile: ResellerProfile): ResellerBrandingFormValues {
  return {
    primaryColor: profile.branding?.primaryColor ?? '',
    secondaryColor: profile.branding?.secondaryColor ?? '',
    theme: profile.branding?.theme ?? 'AUTO',
    customCss: profile.branding?.customCss ?? '',
  };
}

export default function ResellerBrandingPage() {
  const { data, loading, error, refetch } = useResellerProfile();
  const profile = data?.resellerMyProfile;

  if (!profile && loading) return <SettingsLoading />;
  if (!profile || error) return <SettingsLoadError onRetry={() => void refetch()} />;
  return <BrandingForm profile={profile} onStale={() => void refetch()} />;
}

function BrandingForm({ profile, onStale }: { profile: ResellerProfile; onStale: () => void }) {
  const t = useTranslations('resellerSettings');
  const tb = useTranslations('resellerSettings.branding');
  const ability = useAbility();
  const allowed = ability.can('update', 'Reseller');
  const errorMessage = useSettingsErrorMessage();
  const [updateBranding] = useUpdateResellerBranding();
  const tUpload = useTranslations('fileUpload');
  const [logoChange, setLogoChange] = React.useState<ImageChange>(undefined);
  const [faviconChange, setFaviconChange] = React.useState<ImageChange>(undefined);
  const [logoBusy, setLogoBusy] = React.useState(false);
  const [faviconBusy, setFaviconBusy] = React.useState(false);
  const [uploadsKey, setUploadsKey] = React.useState(0);

  const schema = React.useMemo(
    () =>
      createResellerBrandingSchema({
        colorInvalid: tb('colorInvalid'),
        customCssTooLong: tb('customCssTooLong', { max: RESELLER_CUSTOM_CSS_MAX_LENGTH }),
        customCssForbidden: (token) => tb('customCssForbidden', { token }),
      }),
    [tb],
  );

  const form = useAppForm({
    defaultValues: toFormValues(profile),
    validators: { onChange: zodValidator(schema), onSubmit: zodValidator(schema) },
    onSubmit: async ({ value }) => {
      try {
        await updateBranding({
          variables: {
            input: {
              version: profile.version,
              // null returns a value to its default.
              primaryColor: value.primaryColor || null,
              secondaryColor: value.secondaryColor || null,
              theme: value.theme,
              customCss: value.customCss.trim() ? value.customCss : null,
              // An image is sent only when it changes; leaving it out keeps the stored one.
              ...(logoChange !== undefined ? { logoFileId: logoChange } : {}),
              ...(faviconChange !== undefined ? { faviconFileId: faviconChange } : {}),
            },
          },
        });
        setLogoChange(undefined);
        setFaviconChange(undefined);
        setUploadsKey((key) => key + 1);
        toast.success(t('saved'));
      } catch (err) {
        const code = extractGraphQLErrorCode(err);
        const fileError = fileUploadErrorKey(code);
        toast.error(fileError ? tUpload(`errors.${fileError}`, { count: 1 }) : errorMessage(err));
        if (fileError) {
          // The refused upload is gone on the server; drop it here so the next save can succeed.
          setLogoChange(undefined);
          setFaviconChange(undefined);
          setUploadsKey((key) => key + 1);
        }
        if (code === 'CONCURRENT_MODIFICATION') onStale();
      }
    },
  });

  React.useEffect(() => {
    form.reset(toFormValues(profile));
  }, [form, profile]);

  const values = useStore(form.store, (state) => state.values);
  const formDirty = useStore(form.store, (state) => state.isDirty);
  const isDirty = formDirty || logoChange !== undefined || faviconChange !== undefined;
  const uploading = logoBusy || faviconBusy;
  useUnsavedChangesWarning(isDirty);

  // Constant after mount, so opening or closing the section by hand is never undone.
  const [advancedInitiallyOpen] = React.useState(() => !!profile.branding?.customCss);

  const themeOptions = RESELLER_BRANDING_THEME_VALUES.map((theme) => ({
    value: theme,
    label: tb(`themes.${theme}`),
  }));

  const colorField = (
    name: 'primaryColor' | 'secondaryColor',
    fallback: string,
    pickerTestId: string,
    info?: React.ReactNode,
  ) => {
    const current = values[name];
    return (
      <Field>
        <FieldLabel htmlFor={name}>
          {tb(name)}
          {info}
        </FieldLabel>
        <FieldDescription>{tb(`${name}Description`)}</FieldDescription>
        <div className="flex items-start gap-2">
          <input
            type="color"
            value={RESELLER_BRAND_COLOR_RE.test(current) ? current : fallback}
            onChange={(e) => form.setFieldValue(name, e.target.value.toUpperCase())}
            className="mt-0.5 h-9 w-11 shrink-0 cursor-pointer rounded border bg-transparent p-0.5 disabled:cursor-not-allowed"
            aria-label={tb(name)}
            title={tb(name)}
            data-testid={pickerTestId}
          />
          <div className="min-w-0 flex-1">
            <form.AppField name={name}>
              {(field) => (
                <field.TextField
                  label=""
                  placeholder={fallback}
                  maxLength={7}
                  testId={`reseller-settings-${name === 'primaryColor' ? 'primary' : 'secondary'}-color-input`}
                />
              )}
            </form.AppField>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-0.5 shrink-0"
            disabled={current === ''}
            title={tb('useDefault')}
            onClick={() => form.setFieldValue(name, '')}
            data-testid={`reseller-settings-${name === 'primaryColor' ? 'primary' : 'secondary'}-color-reset-btn`}
          >
            {tb('useDefault')}
          </Button>
        </div>
      </Field>
    );
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void form.handleSubmit();
        }}
        className="space-y-6"
        data-testid={resellerSettings.brandingForm}
      >
        {!allowed && <ReadOnlyNotice />}

        <Card>
          <CardHeader>
            <CardTitle>{tb('title')}</CardTitle>
            <CardDescription>{tb('description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <p
              className="mb-6 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground"
              data-testid={resellerSettings.brandingNotAppliedNotice}
            >
              {tb('notAppliedYet')}
            </p>

            <fieldset disabled={!allowed}>
              <FieldGroup>
                <div className="grid gap-6 xl:grid-cols-2">
                  <BrandingImageField
                    name="logo"
                    purpose="RESELLER_LOGO"
                    label={tb('logo')}
                    description={tb('logoDescription')}
                    current={profile.logo}
                    change={logoChange}
                    onChange={setLogoChange}
                    onBusyChange={setLogoBusy}
                    editable={allowed}
                    resetKey={uploadsKey}
                    imageClassName="h-12 w-32 [&>img]:object-contain"
                  />
                  <BrandingImageField
                    name="favicon"
                    purpose="RESELLER_FAVICON"
                    label={tb('favicon')}
                    description={tb('faviconDescription')}
                    current={profile.favicon}
                    change={faviconChange}
                    onChange={setFaviconChange}
                    onBusyChange={setFaviconBusy}
                    editable={allowed}
                    resetKey={uploadsKey}
                    imageClassName="size-12"
                  />
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  {colorField(
                    'primaryColor',
                    DEFAULT_PRIMARY_COLOR,
                    resellerSettings.brandingPrimaryColorPicker,
                    <FieldInfoPopover
                      title={tb('fieldHelp.primaryColorTitle')}
                      data-testid={resellerSettings.brandingPrimaryColorInfo}
                    >
                      <p>{tb('fieldHelp.primaryColorBody')}</p>
                    </FieldInfoPopover>,
                  )}
                  {colorField(
                    'secondaryColor',
                    DEFAULT_SECONDARY_COLOR,
                    resellerSettings.brandingSecondaryColorPicker,
                  )}
                </div>

                <form.AppField name="theme">
                  {(field) => (
                    <field.SelectField
                      label={tb('theme')}
                      description={tb('themeDescription')}
                      options={themeOptions}
                      optional={false}
                      testId="reseller-settings-theme-select"
                    />
                  )}
                </form.AppField>

                <details
                  className="rounded-lg border p-3"
                  open={advancedInitiallyOpen}
                  data-testid={resellerSettings.brandingAdvanced}
                >
                  <summary className="cursor-pointer text-sm font-medium">{tb('advanced')}</summary>
                  <div className="mt-4">
                    <form.AppField name="customCss">
                      {(field) => (
                        <field.TextareaField
                          label={tb('customCss')}
                          description={tb('customCssDescription', {
                            max: RESELLER_CUSTOM_CSS_MAX_LENGTH,
                          })}
                          placeholder={CUSTOM_CSS_SAMPLE}
                          rows={8}
                          testId="reseller-settings-custom-css-input"
                          errorTestId="reseller-settings-custom-css-error"
                          info={
                            <FieldInfoPopover
                              title={tb('fieldHelp.customCssTitle')}
                              data-testid={resellerSettings.brandingCustomCssInfo}
                            >
                              <p>{tb('fieldHelp.customCssBody')}</p>
                              <p>
                                <em>{tb('fieldHelp.customCssExample')}</em>
                              </p>
                            </FieldInfoPopover>
                          }
                        />
                      )}
                    </form.AppField>
                  </div>
                </details>
              </FieldGroup>

              {allowed && (
                <div className="mt-6 flex justify-end">
                  <form.AppForm>
                    <form.SubmitButton
                      testId="reseller-settings-branding-save-btn"
                      disabled={!isDirty || uploading}
                      submittingLabel={t('saving')}
                    >
                      {t('save')}
                    </form.SubmitButton>
                  </form.AppForm>
                </div>
              )}
            </fieldset>
          </CardContent>
        </Card>
      </form>

      <div className="lg:sticky lg:top-4 lg:self-start">
        <BrandingPreview
          name={profile.name}
          logoUrl={logoChange === null ? null : (profile.logo?.url ?? null)}
          primaryColor={values.primaryColor}
          secondaryColor={values.secondaryColor}
          theme={values.theme}
          customCss={values.customCss}
        />
      </div>
    </div>
  );
}
