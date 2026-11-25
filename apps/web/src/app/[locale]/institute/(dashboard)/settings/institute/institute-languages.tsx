'use client';

import { instituteLocaleLabels } from '@roviq/common-types';
import { gql, useMutation } from '@roviq/graphql';
import {
  Button,
  Can,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { useErrorCopy } from '@web/hooks/use-error-copy';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { UpdateInstituteLocalesDocument } from './institute-languages.generated';

export const UPDATE_LOCALES = gql`
  mutation UpdateInstituteLocales($input: UpdateInstituteLocalesInput!) {
    updateInstituteLocales(input: $input) { id supportedLocales defaultLocale version }
  }
`;

export function InstituteLanguages({
  institute,
}: {
  institute: { id: string; supportedLocales: string[]; defaultLocale: string; version: number };
}) {
  const t = useTranslations('instituteSettings.languages');
  const errorCopy = useErrorCopy();
  const [supportedLocales, setSupportedLocales] = useState(institute.supportedLocales);
  const [defaultLocale, setDefaultLocale] = useState(institute.defaultLocale);
  const [save, { loading }] = useMutation(UpdateInstituteLocalesDocument);
  useEffect(() => {
    setSupportedLocales(institute.supportedLocales);
    setDefaultLocale(institute.defaultLocale);
  }, [institute.supportedLocales, institute.defaultLocale]);
  const dirty =
    defaultLocale !== institute.defaultLocale ||
    JSON.stringify(supportedLocales) !== JSON.stringify(institute.supportedLocales);
  async function submit() {
    try {
      await save({
        variables: { input: { supportedLocales, defaultLocale, version: institute.version } },
      });
      toast.success(t('saved'));
    } catch (error) {
      toast.error(errorCopy(error, t('saveFailed')));
    }
  }
  return (
    <Can I="update_config" a="Institute" passThrough>
      {(allowed: boolean) => (
        <Card>
          <CardHeader>
            <CardTitle>{t('title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>{t('description')}</p>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(instituteLocaleLabels).map(([locale, label]) => (
                <Field key={locale} orientation="horizontal">
                  <Checkbox
                    id={`institute-language-${locale}`}
                    checked={supportedLocales.includes(locale)}
                    disabled={!allowed || loading || locale === 'en' || locale === defaultLocale}
                    data-testid={testIds.instituteLocales.language(locale)}
                    onCheckedChange={(checked) =>
                      setSupportedLocales((current) =>
                        checked
                          ? [...current, locale]
                          : current.filter((value) => value !== locale),
                      )
                    }
                  />
                  <FieldLabel htmlFor={`institute-language-${locale}`}>{label}</FieldLabel>
                </Field>
              ))}
            </div>
            <Field>
              <FieldLabel htmlFor="institute-default-language">{t('defaultLanguage')}</FieldLabel>
              <Select
                value={defaultLocale}
                onValueChange={setDefaultLocale}
                disabled={!allowed || loading}
              >
                <SelectTrigger
                  id="institute-default-language"
                  data-testid={testIds.instituteLocales.defaultLanguage}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {supportedLocales.map((locale) => (
                    <SelectItem
                      key={locale}
                      value={locale}
                      data-testid={testIds.instituteLocales.defaultOption(locale)}
                    >
                      {instituteLocaleLabels[locale]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {allowed && (
              <Button
                title={t('save')}
                data-testid={testIds.instituteLocales.save}
                disabled={!dirty || loading}
                onClick={() => void submit()}
              >
                {loading ? t('saving') : t('save')}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </Can>
  );
}
