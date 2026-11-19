'use client';

import { INDIAN_STATE_VALUES } from '@roviq/common-types';
import { extractGraphQLErrorCode } from '@roviq/graphql';
import { zodValidator } from '@roviq/i18n';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FieldDescription,
  FieldGroup,
  FieldLegend,
  FieldSet,
  useAbility,
  useAppForm,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useStore } from '@tanstack/react-form';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { AddressForm } from '../../../../institute/(dashboard)/settings/institute/components/address-form';
import { ContactBuilder } from '../../../../institute/(dashboard)/settings/institute/components/contact-builder';
import {
  ReadOnlyNotice,
  SettingsLoadError,
  SettingsLoading,
  useUnsavedChangesWarning,
} from '../_components/settings-states';
import { type ResellerProfileFormValues, resellerProfileSchema } from '../schemas';
import {
  type ResellerProfile,
  useResellerProfile,
  useSettingsErrorMessage,
  useUpdateResellerProfile,
} from '../use-reseller-settings';

const { resellerSettings } = testIds;

function isIndianState(
  value: string | null | undefined,
): value is (typeof INDIAN_STATE_VALUES)[number] {
  return !!value && (INDIAN_STATE_VALUES as readonly string[]).includes(value);
}

// Server objects carry __typename, which the update input rejects; copy only input fields.
function toFormValues(profile: ResellerProfile): ResellerProfileFormValues {
  const address = profile.address;
  return {
    name: profile.name,
    registrationNumber: profile.registrationNumber ?? '',
    registrationState: isIndianState(profile.registrationState)
      ? profile.registrationState
      : undefined,
    contact: {
      phones: profile.contact.phones.map((p) => ({
        countryCode: p.countryCode,
        number: p.number,
        isPrimary: p.isPrimary,
        isWhatsappEnabled: p.isWhatsappEnabled,
        label: p.label,
      })),
      emails: profile.contact.emails.map((e) => ({
        address: e.address,
        isPrimary: e.isPrimary,
        label: e.label,
      })),
    },
    address: {
      line1: address?.line1 ?? '',
      line2: address?.line2 ?? '',
      line3: address?.line3 ?? '',
      city: address?.city ?? '',
      district: address?.district ?? '',
      state: address?.state ?? '',
      postalCode: address?.postalCode ?? '',
      country: address?.country ?? 'IN',
    },
  };
}

export default function ResellerProfilePage() {
  const { data, loading, error, refetch } = useResellerProfile();
  const profile = data?.resellerMyProfile;

  if (!profile && loading) return <SettingsLoading />;
  if (!profile || error) return <SettingsLoadError onRetry={() => void refetch()} />;
  return <ProfileForm profile={profile} onStale={() => void refetch()} />;
}

function ProfileForm({ profile, onStale }: { profile: ResellerProfile; onStale: () => void }) {
  const t = useTranslations('resellerSettings');
  const tp = useTranslations('resellerSettings.profile');
  const tGeo = useTranslations('geography');
  const ability = useAbility();
  const allowed = ability.can('update', 'Reseller');
  const errorMessage = useSettingsErrorMessage();
  const [updateProfile] = useUpdateResellerProfile();

  const form = useAppForm({
    defaultValues: toFormValues(profile),
    validators: {
      onChange: zodValidator(resellerProfileSchema),
      onSubmit: zodValidator(resellerProfileSchema),
    },
    onSubmit: async ({ value }) => {
      const parsed = resellerProfileSchema.parse(value);
      const { coordinates: _coordinates, ...address } = parsed.address;
      try {
        await updateProfile({
          variables: {
            input: {
              version: profile.version,
              // The system reseller's name is fixed, so it is not sent at all.
              ...(profile.isSystem ? {} : { name: parsed.name }),
              registrationNumber: parsed.registrationNumber || null,
              registrationState: parsed.registrationState ?? null,
              contact: parsed.contact,
              address: address.line1 ? address : null,
            },
          },
        });
        toast.success(t('saved'));
      } catch (err) {
        toast.error(errorMessage(err));
        if (extractGraphQLErrorCode(err) === 'CONCURRENT_MODIFICATION') onStale();
      }
    },
  });

  // A save or a refetch brings a new version: show what the server now holds.
  React.useEffect(() => {
    form.reset(toFormValues(profile));
  }, [form, profile]);

  const isDirty = useStore(form.store, (state) => state.isDirty);
  useUnsavedChangesWarning(isDirty);

  const stateOptions = INDIAN_STATE_VALUES.map((s) => ({ value: s, label: tGeo(`states.${s}`) }));

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
      className="max-w-3xl space-y-6"
      data-testid={resellerSettings.profileForm}
    >
      {!allowed && <ReadOnlyNotice />}

      <fieldset disabled={!allowed} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{tp('identity')}</CardTitle>
            <CardDescription>{tp('identityDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <form.AppField name="name">
                {(field) => (
                  <field.TextField
                    label={tp('name')}
                    description={profile.isSystem ? tp('nameSystemHint') : undefined}
                    disabled={profile.isSystem}
                    maxLength={255}
                    testId="reseller-settings-name-input"
                  />
                )}
              </form.AppField>

              <dl className="grid gap-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">{tp('slug')}</dt>
                  <dd className="mt-1 font-mono" data-testid={resellerSettings.profileSlug}>
                    {profile.slug}
                  </dd>
                  <dd className="mt-1 text-xs text-muted-foreground">{tp('slugHint')}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{tp('tier')}</dt>
                  <dd className="mt-1">
                    <Badge variant="secondary" data-testid={resellerSettings.profileTier}>
                      {tp(`tiers.${profile.tier}`)}
                    </Badge>
                  </dd>
                  <dd className="mt-1 text-xs text-muted-foreground">{tp('tierHint')}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{tp('status')}</dt>
                  <dd className="mt-1">
                    <Badge variant="outline" data-testid={resellerSettings.profileStatus}>
                      {tp(`statuses.${profile.status}`)}
                    </Badge>
                  </dd>
                </div>
              </dl>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{tp('business')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <form.AppField name="registrationNumber">
                {(field) => (
                  <field.TextField
                    label={tp('registrationNumber')}
                    description={tp('registrationNumberHint')}
                    maxLength={50}
                    testId="reseller-settings-registration-number-input"
                  />
                )}
              </form.AppField>
              <form.AppField name="registrationState">
                {(field) => (
                  <field.SelectField
                    label={tp('registrationState')}
                    placeholder={tp('registrationStatePlaceholder')}
                    options={stateOptions}
                    optional
                    testId="reseller-settings-registration-state-select"
                  />
                )}
              </form.AppField>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <FieldGroup>
              <FieldSet>
                <FieldLegend>{tp('contact')}</FieldLegend>
                <FieldDescription>{tp('contactHint')}</FieldDescription>
                <ContactBuilder form={form} />
              </FieldSet>
              <FieldSet>
                <FieldLegend>{tp('address')}</FieldLegend>
                <FieldDescription>{tp('addressHint')}</FieldDescription>
                <AddressForm form={form} />
              </FieldSet>
            </FieldGroup>
          </CardContent>
        </Card>

        {allowed && (
          <div className="flex justify-end">
            <form.AppForm>
              <form.SubmitButton
                testId="reseller-settings-profile-save-btn"
                disabled={!isDirty}
                submittingLabel={t('saving')}
              >
                {t('save')}
              </form.SubmitButton>
            </form.AppForm>
          </div>
        )}
      </fieldset>
    </form>
  );
}
