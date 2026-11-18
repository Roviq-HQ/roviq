'use client';

import { useFormatDate } from '@roviq/i18n';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useTranslations } from 'next-intl';
import {
  STATUS_CLASS,
  STATUS_VARIANT,
  safeHexColor,
  TIER_CLASS,
} from '../../reseller-badge-styles';
import type { ResellerNode } from '../../types';

const { adminResellerDetail } = testIds;

export function ResellerOverview({ reseller }: { reseller: ResellerNode }) {
  const t = useTranslations('adminResellers');
  const tGeo = useTranslations('geography');
  const { format: fmt, formatDistance } = useFormatDate();
  const formatRelative = (date: string) => formatDistance(new Date(date), new Date());
  const formatAbsolute = (date: string) => fmt(new Date(date), 'dd/MM/yyyy');
  const primaryEmail =
    reseller.contact.emails.find((e) => e.isPrimary) ?? reseller.contact.emails[0];
  const primaryPhone =
    reseller.contact.phones.find((p) => p.isPrimary) ?? reseller.contact.phones[0];
  const address = reseller.address;
  const stateLabel = (state: string) =>
    tGeo.has(`states.${state}`) ? tGeo(`states.${state}`) : state;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Identity card */}
      <Card>
        <CardHeader>
          <CardTitle>{t('detail.identity')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('detail.fieldName')}</span>
            <span className="font-medium" data-testid={adminResellerDetail.detailName}>
              {reseller.name}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('detail.fieldSlug')}</span>
            <span className="font-mono" data-testid={adminResellerDetail.detailSlug}>
              {reseller.slug}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('detail.fieldTier')}</span>
            <Badge
              variant="secondary"
              className={TIER_CLASS[reseller.tier]}
              data-testid={adminResellerDetail.detailTier}
            >
              {t(`tiers.${reseller.tier}`)}
            </Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('detail.fieldStatus')}</span>
            <Badge
              variant={STATUS_VARIANT[reseller.status]}
              className={STATUS_CLASS[reseller.status]}
              data-testid={adminResellerDetail.detailStatus}
            >
              {t(`statuses.${reseller.status}`)}
            </Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('detail.fieldCustomDomain')}</span>
            <span data-testid={adminResellerDetail.detailDomain}>
              {reseller.customDomain ?? (
                <span className="text-muted-foreground">{t('detail.noDomain')}</span>
              )}
            </span>
          </div>
          {reseller.suspendedAt && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('detail.fieldSuspendedAt')}</span>
              <span data-testid={adminResellerDetail.detailSuspendedAt}>
                {formatAbsolute(reseller.suspendedAt)}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats card */}
      <Card>
        <CardHeader>
          <CardTitle>{t('detail.stats')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('detail.fieldInstituteCount')}</span>
            <span
              className="font-semibold tabular-nums"
              data-testid={adminResellerDetail.detailInstituteCount}
            >
              {reseller.instituteCount}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('detail.fieldTeamSize')}</span>
            <span
              className="font-semibold tabular-nums"
              data-testid={adminResellerDetail.detailTeamSize}
            >
              {reseller.teamSize}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('detail.fieldCreatedAt')}</span>
            <span
              className="text-muted-foreground"
              data-testid={adminResellerDetail.detailCreatedAt}
            >
              {formatRelative(reseller.createdAt)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('detail.fieldUpdatedAt')}</span>
            <span
              className="text-muted-foreground"
              data-testid={adminResellerDetail.detailUpdatedAt}
            >
              {formatRelative(reseller.updatedAt)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Business details card */}
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>{t('detail.business')}</CardTitle>
        </CardHeader>
        <CardContent
          className="grid gap-3 text-sm sm:grid-cols-2"
          data-testid={adminResellerDetail.detailBusiness}
        >
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{t('detail.fieldRegistrationNumber')}</span>
            <span className="font-mono" data-testid={adminResellerDetail.detailRegistrationNumber}>
              {reseller.registrationNumber ?? '—'}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{t('detail.fieldRegistrationState')}</span>
            <span data-testid={adminResellerDetail.detailRegistrationState}>
              {reseller.registrationState ? stateLabel(reseller.registrationState) : '—'}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{t('detail.fieldContactEmail')}</span>
            <span data-testid={adminResellerDetail.detailContactEmail}>
              {primaryEmail?.address ?? '—'}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{t('detail.fieldContactPhone')}</span>
            <span className="tabular-nums" data-testid={adminResellerDetail.detailContactPhone}>
              {primaryPhone ? `${primaryPhone.countryCode} ${primaryPhone.number}` : '—'}
            </span>
          </div>
          <div className="flex justify-between gap-4 sm:col-span-2">
            <span className="text-muted-foreground">{t('detail.address')}</span>
            <span className="text-end" data-testid={adminResellerDetail.detailAddress}>
              {address
                ? [
                    address.line1,
                    address.line2,
                    address.city,
                    address.district,
                    stateLabel(address.state),
                    address.postalCode,
                  ]
                    .filter(Boolean)
                    .join(', ')
                : '—'}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Branding card */}
      {reseller.branding && (
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>{t('detail.branding')}</CardTitle>
          </CardHeader>
          <CardContent
            className="grid gap-3 text-sm sm:grid-cols-2"
            data-testid={adminResellerDetail.detailBranding}
          >
            {reseller.branding.logoUrl && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('detail.brandingLogoUrl')}</span>
                <a
                  href={reseller.branding.logoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-primary underline-offset-2 hover:underline"
                  data-testid={adminResellerDetail.detailLogoUrl}
                >
                  {reseller.branding.logoUrl}
                </a>
              </div>
            )}
            {reseller.branding.faviconUrl && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('detail.brandingFaviconUrl')}</span>
                <a
                  href={reseller.branding.faviconUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-primary underline-offset-2 hover:underline"
                  data-testid={adminResellerDetail.detailFaviconUrl}
                >
                  {reseller.branding.faviconUrl}
                </a>
              </div>
            )}
            {reseller.branding.primaryColor && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('detail.brandingPrimaryColor')}</span>
                <div className="flex items-center gap-2">
                  {(() => {
                    const safe = safeHexColor(reseller.branding.primaryColor);
                    // Only render the swatch when the color matches the strict
                    // hex-6 pattern. Defense-in-depth against a poisoned DB row
                    // smuggling CSS through the inline style prop.
                    return safe ? (
                      <span
                        className="inline-block size-4 rounded border"
                        style={{ background: safe }}
                      />
                    ) : null;
                  })()}
                  <span className="font-mono" data-testid={adminResellerDetail.detailPrimaryColor}>
                    {reseller.branding.primaryColor}
                  </span>
                </div>
              </div>
            )}
            {reseller.branding.secondaryColor && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('detail.brandingSecondaryColor')}</span>
                <div className="flex items-center gap-2">
                  {(() => {
                    const safe = safeHexColor(reseller.branding.secondaryColor);
                    return safe ? (
                      <span
                        className="inline-block size-4 rounded border"
                        style={{ background: safe }}
                      />
                    ) : null;
                  })()}
                  <span
                    className="font-mono"
                    data-testid={adminResellerDetail.detailSecondaryColor}
                  >
                    {reseller.branding.secondaryColor}
                  </span>
                </div>
              </div>
            )}
            {!reseller.branding.logoUrl &&
              !reseller.branding.faviconUrl &&
              !reseller.branding.primaryColor &&
              !reseller.branding.secondaryColor && (
                <p className="text-muted-foreground">{t('detail.noBranding')}</p>
              )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
