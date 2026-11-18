'use client';

import { INDIAN_STATE_VALUES, optionalAddressSchema } from '@roviq/common-types';
import { extractGraphQLErrorCode } from '@roviq/graphql';
import { emptyStringToUndefined, zodValidator } from '@roviq/i18n';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldDescription,
  FieldGroup,
  FieldLegend,
  FieldSet,
  useAppForm,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { AddressForm } from '../../../../../institute/(dashboard)/settings/institute/components/address-form';
import { ContactBuilder } from '../../../../../institute/(dashboard)/settings/institute/components/contact-builder';
import { compactBranding, FQDN_RE, HEX_COLOR_RE, HTTP_URL_RE } from '../../reseller-validators';
import type { ResellerNode } from '../../types';
import { useResellerErrorMessage } from '../../use-reseller-error-message';
import { useUpdateReseller } from '../../use-resellers';

const { adminResellerDetail } = testIds;

const phoneSchema = z.object({
  countryCode: z.string().default('+91'),
  number: z.string().regex(/^\d{10}$/),
  isPrimary: z.boolean().default(false),
  isWhatsappEnabled: z.boolean().default(false),
  label: z.string().max(50).default(''),
});

const emailSchema = z.object({
  address: z.string().email(),
  isPrimary: z.boolean().default(false),
  label: z.string().max(50).default(''),
});

const editResellerSchema = z.object({
  name: z.string().min(2).max(255),
  customDomain: emptyStringToUndefined(z.string().max(255).regex(FQDN_RE).optional()),
  registrationNumber: z.string().max(50).default(''),
  registrationState: z.enum(INDIAN_STATE_VALUES).optional(),
  contact: z.object({
    phones: z.array(phoneSchema).default([]),
    emails: z.array(emailSchema).default([]),
  }),
  address: optionalAddressSchema,
  branding: z.object({
    logoUrl: emptyStringToUndefined(z.string().regex(HTTP_URL_RE).optional()),
    faviconUrl: emptyStringToUndefined(z.string().regex(HTTP_URL_RE).optional()),
    primaryColor: emptyStringToUndefined(z.string().regex(HEX_COLOR_RE).optional()),
    secondaryColor: emptyStringToUndefined(z.string().regex(HEX_COLOR_RE).optional()),
  }),
});

type EditResellerFormValues = z.input<typeof editResellerSchema>;

function isIndianState(
  value: string | null | undefined,
): value is (typeof INDIAN_STATE_VALUES)[number] {
  return !!value && (INDIAN_STATE_VALUES as readonly string[]).includes(value);
}

// Server objects carry __typename, which the update input rejects; copy only input fields.
function toDefaults(reseller: ResellerNode): EditResellerFormValues {
  const address = reseller.address;
  return {
    name: reseller.name,
    customDomain: reseller.customDomain ?? '',
    registrationNumber: reseller.registrationNumber ?? '',
    registrationState: isIndianState(reseller.registrationState)
      ? reseller.registrationState
      : undefined,
    contact: {
      phones: reseller.contact.phones.map((p) => ({
        countryCode: p.countryCode,
        number: p.number,
        isPrimary: p.isPrimary,
        isWhatsappEnabled: p.isWhatsappEnabled,
        label: p.label,
      })),
      emails: reseller.contact.emails.map((e) => ({
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
    branding: {
      logoUrl: reseller.branding?.logoUrl ?? '',
      faviconUrl: reseller.branding?.faviconUrl ?? '',
      primaryColor: reseller.branding?.primaryColor ?? '',
      secondaryColor: reseller.branding?.secondaryColor ?? '',
    },
  };
}

export function EditResellerDialog({
  reseller,
  open,
  onClose,
  onStale,
}: {
  reseller: ResellerNode;
  open: boolean;
  onClose: () => void;
  /** Called when the save lost a race, so the page can reload the latest version. */
  onStale: () => void;
}) {
  const t = useTranslations('adminResellers');
  const tGeo = useTranslations('geography');
  const errorMessage = useResellerErrorMessage();
  const [updateReseller] = useUpdateReseller();

  const form = useAppForm({
    defaultValues: toDefaults(reseller),
    validators: {
      onChange: zodValidator(editResellerSchema),
      onSubmit: zodValidator(editResellerSchema),
    },
    onSubmit: async ({ value }) => {
      const parsed = editResellerSchema.parse(value);
      const branding = compactBranding(parsed.branding);
      const { coordinates: _coordinates, ...address } = parsed.address;
      try {
        await updateReseller({
          variables: {
            id: reseller.id,
            input: {
              version: reseller.version,
              name: parsed.name,
              customDomain: parsed.customDomain ?? null,
              registrationNumber: parsed.registrationNumber || null,
              registrationState: parsed.registrationState ?? null,
              contact: parsed.contact,
              address: address.line1 ? address : null,
              // An all-empty branding block would wipe the stored one, so leave it out.
              ...(branding ? { branding } : {}),
            },
          },
        });
        toast.success(t('actions.editSuccess'));
        onClose();
      } catch (err) {
        toast.error(errorMessage(err));
        if (extractGraphQLErrorCode(err) === 'CONCURRENT_MODIFICATION') onStale();
      }
    },
  });

  // Each open starts from the latest server state.
  React.useEffect(() => {
    if (open) form.reset(toDefaults(reseller));
  }, [open, form, reseller]);

  const stateOptions = INDIAN_STATE_VALUES.map((s) => ({ value: s, label: tGeo(`states.${s}`) }));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle data-testid={adminResellerDetail.editDialogTitle}>
            {t('actions.editTitle')}
          </DialogTitle>
          <DialogDescription>{t('actions.editDescription')}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
          className="space-y-6"
          data-testid={adminResellerDetail.editForm}
        >
          <FieldGroup>
            <FieldSet>
              <FieldLegend>{t('detail.identity')}</FieldLegend>
              <form.AppField name="name">
                {(field) => (
                  <field.TextField
                    label={t('detail.fieldName')}
                    testId="edit-reseller-name-input"
                  />
                )}
              </form.AppField>
              <form.AppField name="customDomain">
                {(field) => (
                  <field.TextField
                    label={t('detail.fieldCustomDomain')}
                    description={t('detail.customDomainHint')}
                    placeholder="portal.example.com"
                    testId="edit-reseller-domain-input"
                  />
                )}
              </form.AppField>
            </FieldSet>

            <FieldSet>
              <FieldLegend>{t('detail.business')}</FieldLegend>
              <div className="grid gap-3 sm:grid-cols-2">
                <form.AppField name="registrationNumber">
                  {(field) => (
                    <field.TextField
                      label={t('detail.fieldRegistrationNumber')}
                      description={t('detail.registrationNumberHint')}
                      testId="edit-reseller-registration-number-input"
                    />
                  )}
                </form.AppField>
                <form.AppField name="registrationState">
                  {(field) => (
                    <field.SelectField
                      label={t('detail.fieldRegistrationState')}
                      placeholder={t('detail.registrationStatePlaceholder')}
                      options={stateOptions}
                      optional
                      testId="edit-reseller-registration-state-select"
                    />
                  )}
                </form.AppField>
              </div>
            </FieldSet>

            <FieldSet>
              <FieldLegend>{t('detail.contact')}</FieldLegend>
              <FieldDescription>{t('detail.contactHint')}</FieldDescription>
              <ContactBuilder form={form} />
            </FieldSet>

            <FieldSet>
              <FieldLegend>{t('detail.address')}</FieldLegend>
              <FieldDescription>{t('detail.addressHint')}</FieldDescription>
              <AddressForm form={form} />
            </FieldSet>

            <FieldSet>
              <FieldLegend>{t('detail.branding')}</FieldLegend>
              <div className="grid gap-3 sm:grid-cols-2">
                <form.AppField name="branding.logoUrl">
                  {(field) => (
                    <field.TextField
                      label={t('detail.brandingLogoUrl')}
                      testId="edit-logo-url-input"
                    />
                  )}
                </form.AppField>
                <form.AppField name="branding.faviconUrl">
                  {(field) => (
                    <field.TextField
                      label={t('detail.brandingFaviconUrl')}
                      testId="edit-favicon-url-input"
                    />
                  )}
                </form.AppField>
                <form.AppField name="branding.primaryColor">
                  {(field) => (
                    <field.TextField
                      label={t('detail.brandingPrimaryColor')}
                      placeholder="#1677FF"
                      testId="edit-primary-color-input"
                    />
                  )}
                </form.AppField>
                <form.AppField name="branding.secondaryColor">
                  {(field) => (
                    <field.TextField
                      label={t('detail.brandingSecondaryColor')}
                      placeholder="#5BC0EB"
                      testId="edit-secondary-color-input"
                    />
                  )}
                </form.AppField>
              </div>
            </FieldSet>
          </FieldGroup>

          <DialogFooter className="sticky bottom-0 bg-background pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              data-testid={adminResellerDetail.editCancelBtn}
            >
              {t('actions.cancel')}
            </Button>
            <form.AppForm>
              <form.SubmitButton testId="edit-save-btn" submittingLabel={t('actions.saving')}>
                {t('actions.saveChanges')}
              </form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
