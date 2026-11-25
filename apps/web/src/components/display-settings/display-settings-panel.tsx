'use client';

import { FORM_HELP_MODE_VALUES, type FormHelpMode } from '@roviq/common-types';
import {
  Button,
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLabelWithInfo,
  FieldLegend,
  FieldSet,
  FormHelpModeProvider,
  Input,
  RadioGroup,
  RadioGroupItem,
  useFieldHelpIds,
} from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { displaySettingsHelp } from '@web/help/display-settings/display-settings.help';
import { useTranslations } from 'next-intl';
import { useDisplaySettings } from './display-settings-context';

const { displaySettings } = testIds;
const SAMPLE_ID = 'display-settings-sample';

function isFormHelpMode(value: string): value is FormHelpMode {
  return FORM_HELP_MODE_VALUES.some((mode) => mode === value);
}

/** Display settings sections; shown in the Display settings dialog and on My Account. */
export function DisplaySettingsPanel() {
  const t = useTranslations('account.displaySettings');
  const { formHelpMode, loading, loadFailed, saving, readOnly, saveFormHelpMode, reload } =
    useDisplaySettings();
  const busy = loading || saving;

  return (
    <FieldSet>
      <FieldLegend>{t('formHelp.title')}</FieldLegend>
      <FieldDescription>{t('formHelp.description')}</FieldDescription>
      <RadioGroup
        value={formHelpMode}
        onValueChange={(value) => {
          if (isFormHelpMode(value) && value !== formHelpMode) saveFormHelpMode(value);
        }}
        disabled={readOnly || busy}
        aria-label={t('formHelp.title')}
        aria-busy={busy}
      >
        {FORM_HELP_MODE_VALUES.map((mode) => (
          <Field key={mode} orientation="horizontal">
            <RadioGroupItem
              value={mode}
              id={`form-help-mode-${mode}`}
              data-testid={displaySettings.modeOption(mode)}
            />
            <FieldContent>
              <FieldLabel htmlFor={`form-help-mode-${mode}`}>{t(`formHelp.${mode}`)}</FieldLabel>
              <FieldDescription>{t(`formHelp.${mode}Description`)}</FieldDescription>
            </FieldContent>
          </Field>
        ))}
      </RadioGroup>
      {busy ? (
        <FieldDescription role="status" data-testid={displaySettings.status}>
          {t(saving ? 'saving' : 'loading')}
        </FieldDescription>
      ) : null}
      {readOnly ? <FieldDescription>{t('impersonating')}</FieldDescription> : null}
      {loadFailed ? (
        <div className="flex flex-wrap items-center gap-2">
          <FieldDescription role="alert">{t('loadFailed')}</FieldDescription>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={reload}
            title={t('retry')}
            data-testid={displaySettings.retry}
          >
            {t('retry')}
          </Button>
        </div>
      ) : null}
      <div className="rounded-md border border-dashed p-3">
        <FieldDescription className="mb-2 text-xs font-medium uppercase tracking-wide">
          {t('formHelp.preview')}
        </FieldDescription>
        <FormHelpModeProvider mode={formHelpMode}>
          <SampleField
            label={t('formHelp.sampleLabel')}
            placeholder={t('formHelp.samplePlaceholder')}
          />
        </FormHelpModeProvider>
      </div>
    </FieldSet>
  );
}

function SampleField({ label, placeholder }: { label: string; placeholder: string }) {
  const help = displaySettingsHelp.sampleAdmissionNumber;
  const ids = useFieldHelpIds({ name: SAMPLE_ID, help, hasDescription: false, invalid: false });
  return (
    <Field>
      <FieldLabelWithInfo htmlFor={SAMPLE_ID} help={help} hintId={ids.hintId}>
        {label}
      </FieldLabelWithInfo>
      <Input
        id={SAMPLE_ID}
        placeholder={placeholder}
        aria-describedby={ids.describedBy}
        data-testid={displaySettings.sampleInput}
      />
    </Field>
  );
}
