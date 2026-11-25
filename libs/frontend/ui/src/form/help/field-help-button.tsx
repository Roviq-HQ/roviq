'use client';

import { FieldInfoPopover } from '@roviq/ui/components/ui/field-info-popover';
import { useTranslations } from 'next-intl';
import type { FieldHelpTopic } from './field-help';
import { useHelpText } from './use-help-text';

export interface FieldHelpButtonProps {
  topic: FieldHelpTopic;
  /** The field's visible label, for the button's accessible name. */
  fieldLabel?: string;
  /** Option labels as the form shows them, keyed by option value. */
  optionLabels?: Readonly<Record<string, string>>;
  'data-testid'?: string;
}

/** The ⓘ button and popover for one help topic. */
export function FieldHelpButton({
  topic,
  fieldLabel,
  optionLabels,
  'data-testid': testId,
}: FieldHelpButtonProps) {
  const t = useTranslations('common.fieldHelp');
  const text = useHelpText();
  const title = text(topic.title, topic.values);
  const options = Object.entries(topic.options ?? {}).flatMap(([value, help]) =>
    help ? [{ value, label: optionLabels?.[value] ?? value, help: text(help, topic.values) }] : [],
  );
  return (
    <FieldInfoPopover
      title={title}
      triggerLabel={t('moreAbout', { label: fieldLabel || title })}
      data-testid={testId ?? `field-help-${topic.id}`}
    >
      <p>{text(topic.body, topic.values)}</p>
      {options.length > 0 && (
        <ul>
          {options.map((option) => (
            <li key={option.value}>
              <em>{option.label}</em>: {option.help}
            </li>
          ))}
        </ul>
      )}
      {topic.example && (
        <p>
          <em>{t('example')}</em> {text(topic.example, topic.values)}
        </p>
      )}
    </FieldInfoPopover>
  );
}
