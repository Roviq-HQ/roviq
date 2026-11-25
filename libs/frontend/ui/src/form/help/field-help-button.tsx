'use client';

import { Button } from '@roviq/ui/components/ui/button';
import { FieldInfoPopover } from '@roviq/ui/components/ui/field-info-popover';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import type { FieldHelpTopic, HelpArticle } from './field-help';
import { HelpArticleSheet } from './help-article';
import { useHelpText } from './use-help-text';

export interface FieldHelpButtonProps {
  topic: FieldHelpTopic;
  /** The field's visible label, for the button's accessible name. */
  fieldLabel?: string;
  /** Option labels as the form shows them, keyed by option value. */
  optionLabels?: Readonly<Record<string, string>>;
  'data-testid'?: string;
}

type ArticleState =
  | { status: 'closed' }
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; article: HelpArticle };

/** The ⓘ button and popover for one help topic, with "Read more" when it has an article. */
export function FieldHelpButton({
  topic,
  fieldLabel,
  optionLabels,
  'data-testid': testId,
}: FieldHelpButtonProps) {
  const t = useTranslations('common.fieldHelp');
  const text = useHelpText();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [articleState, setArticleState] = useState<ArticleState>({ status: 'closed' });
  const title = text(topic.title, topic.values);
  const options = Object.entries(topic.options ?? {}).flatMap(([value, help]) =>
    help ? [{ value, label: optionLabels?.[value] ?? value, help: text(help, topic.values) }] : [],
  );
  const loadArticle = topic.article;

  const openArticle = () => {
    if (!loadArticle) return;
    setPopoverOpen(false);
    setArticleState({ status: 'loading' });
    loadArticle().then(
      (article) => setArticleState({ status: 'ready', article }),
      () => setArticleState({ status: 'failed' }),
    );
  };

  return (
    <>
      <FieldInfoPopover
        title={title}
        triggerLabel={t('moreAbout', { label: fieldLabel || title })}
        open={popoverOpen}
        onOpenChange={setPopoverOpen}
        triggerRef={triggerRef}
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
        {loadArticle && (
          <p>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={openArticle}
              data-testid={`field-help-read-more-${topic.id}`}
            >
              {t('readMore')}
            </Button>
          </p>
        )}
      </FieldInfoPopover>
      {loadArticle && (
        <HelpArticleSheet
          article={articleState.status === 'ready' ? articleState.article : null}
          failed={articleState.status === 'failed'}
          onRetry={openArticle}
          values={topic.values}
          open={articleState.status !== 'closed'}
          onOpenChange={(open) => {
            if (!open) setArticleState({ status: 'closed' });
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
          data-testid={`field-help-article-${topic.id}`}
        />
      )}
    </>
  );
}
