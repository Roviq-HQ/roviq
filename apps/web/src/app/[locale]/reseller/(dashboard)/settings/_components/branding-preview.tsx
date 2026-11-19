'use client';

import type { ResellerBrandingTheme } from '@roviq/common-types';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useLocale, useTranslations } from 'next-intl';
import * as React from 'react';
import { buildPreviewDocument } from './build-preview-document';

const { resellerSettings } = testIds;

export interface BrandingPreviewProps {
  name: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  theme: ResellerBrandingTheme;
  customCss: string;
}

export function BrandingPreview(props: BrandingPreviewProps) {
  const t = useTranslations('resellerSettings.branding');
  const locale = useLocale();
  const { name, logoUrl, primaryColor, secondaryColor, theme, customCss } = props;

  const srcDoc = React.useMemo(
    () =>
      buildPreviewDocument({
        name,
        logoUrl,
        locale,
        primaryColor,
        secondaryColor,
        theme,
        customCss,
        labels: {
          dashboard: t('previewSample.dashboard'),
          institutes: t('previewSample.institutes'),
          team: t('previewSample.team'),
          settings: t('previewSample.settings'),
          heading: t('previewSample.heading'),
          body: t('previewSample.body'),
          button: t('previewSample.button'),
        },
      }),
    [name, logoUrl, locale, primaryColor, secondaryColor, theme, customCss, t],
  );

  return (
    <div className="overflow-hidden rounded-lg border">
      <p className="border-b p-3 text-xs font-medium text-muted-foreground">{t('preview')}</p>
      {/* sandbox="" gives the frame no scripts and no access to this page or its cookies. */}
      <iframe
        title={t('previewFrameTitle')}
        sandbox=""
        srcDoc={srcDoc}
        className="block h-[272px] w-full border-0"
        data-testid={resellerSettings.brandingPreview}
      />
    </div>
  );
}
