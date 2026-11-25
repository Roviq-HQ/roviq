'use client';

import { Button } from '@roviq/ui/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@roviq/ui/components/ui/sheet';
import { useMediaQuery } from '@roviq/ui/hooks/use-media-query';
import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { HelpArticle as HelpArticleContent } from './field-help';
import { useHelpText } from './use-help-text';

/** Renders a typed help article: headings, paragraphs, numbered steps, a warning. */
export function HelpArticleBody({
  article,
  values,
}: {
  article: HelpArticleContent;
  values?: Readonly<Record<string, string | number>>;
}) {
  const text = useHelpText();
  return (
    <div className="space-y-5 text-sm leading-relaxed">
      {article.sections.map((section) => (
        <section key={section.heading.en} className="space-y-2">
          <h3 className="font-medium text-foreground">{text(section.heading, values)}</h3>
          {section.warning && (
            <p
              role="note"
              className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-foreground"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
              <span>{text(section.warning, values)}</span>
            </p>
          )}
          {section.paragraphs?.map((paragraph) => (
            <p key={paragraph.en} className="text-muted-foreground">
              {text(paragraph, values)}
            </p>
          ))}
          {section.steps && (
            <ol className="list-decimal space-y-1 ps-5 text-muted-foreground">
              {section.steps.map((step) => (
                <li key={step.en}>{text(step, values)}</li>
              ))}
            </ol>
          )}
        </section>
      ))}
    </div>
  );
}

/** The article in a sheet over the form: from the side on desktop, from the bottom on phones. */
export function HelpArticleSheet({
  article,
  failed = false,
  onRetry,
  values,
  open,
  onOpenChange,
  onCloseAutoFocus,
  'data-testid': testId,
}: {
  article: HelpArticleContent | null;
  /** Loading the article failed; show the error and a Retry button. */
  failed?: boolean;
  onRetry?: () => void;
  values?: Readonly<Record<string, string | number>>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
  'data-testid'?: string;
}) {
  const t = useTranslations('common.fieldHelp');
  const text = useHelpText();
  const desktop = useMediaQuery('(min-width: 768px)');
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={desktop ? 'right' : 'bottom'}
        className="overflow-y-auto data-[side=bottom]:max-h-[85vh] data-[side=right]:sm:max-w-md"
        onCloseAutoFocus={onCloseAutoFocus}
        data-testid={testId}
      >
        <SheetHeader>
          <SheetTitle>{article ? text(article.title, values) : t('articleTitle')}</SheetTitle>
          <SheetDescription className="sr-only">{t('articleDescription')}</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          {article ? (
            <HelpArticleBody article={article} values={values} />
          ) : failed ? (
            <div role="alert" className="space-y-3">
              <p className="text-muted-foreground">{t('articleFailed')}</p>
              {onRetry && (
                <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                  {t('retry')}
                </Button>
              )}
            </div>
          ) : (
            <p aria-busy="true" className="text-muted-foreground">
              {t('loading')}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
