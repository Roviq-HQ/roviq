'use client';

import { Button } from '@roviq/ui/components/ui/button';
import { FieldInfoPopover } from '@roviq/ui/components/ui/field-info-popover';
import { CircleCheck, TriangleAlert } from 'lucide-react';
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
        {topic.points ? (
          <RichHelpContent
            lead={text(topic.body, topic.values)}
            points={topic.points.map((point) => text(point, topic.values))}
            options={options}
            optionHeading={t('optionHeading')}
            meaningHeading={t('meaningHeading')}
            good={topic.example ? text(topic.example, topic.values) : undefined}
            goodLabel={topic.avoid ? t('good') : t('example')}
            avoid={topic.avoid ? text(topic.avoid, topic.values) : undefined}
            avoidLabel={t('avoid')}
          />
        ) : (
          <>
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
          </>
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

interface RichHelpContentProps {
  lead: string;
  points: readonly string[];
  options: readonly { value: string; label: string; help: string }[];
  optionHeading: string;
  meaningHeading: string;
  good?: string;
  goodLabel: string;
  avoid?: string;
  avoidLabel: string;
}

/** The rich layout: bold lead, bulleted rules, options table, then good and avoid lines. */
function RichHelpContent({
  lead,
  points,
  options,
  optionHeading,
  meaningHeading,
  good,
  goodLabel,
  avoid,
  avoidLabel,
}: RichHelpContentProps) {
  const [leadSentence, leadRest] = splitFirstSentence(lead);
  return (
    <div className="space-y-2.5">
      <p className="leading-snug">
        <span className="font-semibold text-foreground">{leadSentence}</span>
        {leadRest && ` ${leadRest}`}
      </p>
      {points.length > 0 && (
        <ul className="list-disc space-y-1 ps-4 marker:text-muted-foreground">
          {points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      )}
      {options.length > 0 && (
        <table className="w-full border-collapse text-start text-[13px]">
          <thead>
            <tr className="border-b border-border/60 text-xs text-muted-foreground">
              <th scope="col" className="py-1 pe-3 text-start font-medium">
                {optionHeading}
              </th>
              <th scope="col" className="py-1 text-start font-medium">
                {meaningHeading}
              </th>
            </tr>
          </thead>
          <tbody>
            {options.map((option) => (
              <tr key={option.value} className="border-b border-border/40 last:border-0">
                <th
                  scope="row"
                  className="py-1.5 pe-3 text-start align-top font-semibold whitespace-nowrap text-foreground"
                >
                  {option.label}
                </th>
                <td className="py-1.5 align-top">{option.help}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {good && (
        <p className="flex items-start gap-2 rounded-md bg-emerald-500/10 px-2.5 py-1.5 text-foreground">
          <CircleCheck
            className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
          <span>
            <span className="font-semibold">{goodLabel}</span> {good}
          </span>
        </p>
      )}
      {avoid && (
        <p className="flex items-start gap-2 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-foreground">
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          <span>
            <span className="font-semibold">{avoidLabel}</span> {avoid}
          </span>
        </p>
      )}
    </div>
  );
}

/** The first sentence (ending in ".", "।", "?" or "!") and the rest, for the bold lead. */
function splitFirstSentence(text: string): [string, string] {
  const match = /^(.+?[.।?!])\s+(\S[\s\S]*)$/u.exec(text);
  return match ? [match[1], match[2]] : [text, ''];
}
