import type { Locale } from '@roviq/i18n';

/** App-owned help copy in every UI locale; a missing locale is a type error. */
export type HelpText = Readonly<Record<Locale, string>>;

export const FORM_HELP_MODES = ['ICON_AND_HINT', 'ICON_ONLY'] as const;
export type FormHelpMode = (typeof FORM_HELP_MODES)[number];
export const DEFAULT_FORM_HELP_MODE: FormHelpMode = 'ICON_AND_HINT';

export const HELP_LIMITS = { hint: 80, body: 400 } as const;

export interface HelpArticleSection {
  heading: HelpText;
  paragraphs?: readonly HelpText[];
  steps?: readonly HelpText[];
  warning?: HelpText;
}

export interface HelpArticle {
  title: HelpText;
  sections: readonly HelpArticleSection[];
}

export interface FieldHelpTopicInput {
  title: HelpText;
  /** What the field is, why it is asked, what it changes. */
  body: HelpText;
  /** One sentence shown under the label in `ICON_AND_HINT` mode. */
  hint?: HelpText;
  /** An institute example. */
  example?: HelpText;
  /** What each choice changes, keyed by the real option value. */
  options?: Readonly<Partial<Record<string, HelpText>>>;
  /** Real shared constants, used as `{name}` in the copy so limits cannot drift. */
  values?: Readonly<Record<string, string | number>>;
  /** Long article, loaded only when opened. */
  article?: () => Promise<HelpArticle>;
}

export interface FieldHelpTopic extends FieldHelpTopicInput {
  /** `<scope>.<key>`, stable: the drift check and the lock file use it. */
  id: string;
}

/**
 * The code each topic describes, for the drift check (`<form>.help.sources.ts`, never imported by
 * a form): `file`, `file#Symbol` or `file#Symbol.member`, relative to the repository root.
 */
export type HelpSources<T> = { readonly [K in keyof T]: readonly string[] };

type DefinedTopics<TScope extends string, T extends Record<string, FieldHelpTopicInput>> = {
  readonly [K in keyof T & string]: T[K] & { readonly id: `${TScope}.${K}` };
};

/** Declares the help topics of one form. Lives in `apps/web/src/help/<area>/<form>.help.ts`. */
export function defineFieldHelp<
  const TScope extends string,
  const T extends Record<string, FieldHelpTopicInput>,
>(scope: TScope, topics: T): DefinedTopics<TScope, T> {
  return Object.fromEntries(
    Object.entries(topics).map(([key, topic]) => [key, { ...topic, id: `${scope}.${key}` }]),
  ) as DefinedTopics<TScope, T>;
}

/** Option help keyed by an enum's values: `helpOptions<SocialCategory>({ GENERAL: … })`. */
export function helpOptions<TValue extends string>(
  options: Readonly<Partial<Record<TValue, HelpText>>>,
): Readonly<Partial<Record<string, HelpText>>> {
  return options;
}

export function resolveHelpText(
  text: HelpText,
  locale: string,
  values?: Readonly<Record<string, string | number>>,
): string {
  const raw = (text as Readonly<Record<string, string>>)[locale] ?? text.en;
  if (!values) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}
