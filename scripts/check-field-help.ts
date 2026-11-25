// CI guard for field help (ROV-345). Two rules:
//
// 1. Help topics. Every `defineFieldHelp(scope, { … })` lives under `apps/web/src/help/`. In it:
//    - each topic id (`<scope>.<key>`) is unique across all help files;
//    - each help text (`title`, `body`, `hint`, `example`, `avoid`, every `points` and `options`
//      entry) is an object literal with a non-empty string literal for every UI locale (`en`,
//      `hi`), so the copy can be read here and by the drift check;
//    - `hint` is at most HELP_LIMITS.hint characters and `body` at most HELP_LIMITS.body, per locale;
//    - `article` is a function returning `import('./<file>')` of a file that exists;
//    - each topic is used (`<exportName>.<key>`) somewhere in `apps/web/src` outside the help folder.
//
// 2. Nothing between a label and its input. Inside a `<Field>`, and inside a `<FieldSet>` whose
//    `<FieldLegend variant="label">` labels one field, a `<FieldDescription>` or a `<p>` with
//    `text-muted-foreground` in a literal className must not come before the first input-like
//    element. Only text at the field's own level counts (not inside a nested element such as a drop
//    zone or a horizontal field's `FieldContent`), and only when an input follows it on the same
//    render path: the branches of `a ? b : c` are alternatives, and a field with no input (a
//    read-only value) passes. A nested Field or FieldSet counts as an input. Input-like is any
//    element that
//      - has an `id` attribute, or
//      - is named one of INPUT_TAGS, or
//      - has a name ending in one of INPUT_SUFFIXES (`SectionPicker`, `MoneyField`, `FileUpload`, …).
//    The topic hint (`<FieldHint>`, or the one `FieldLabelWithInfo` renders from `help`) is the only
//    text allowed there. A section intro under a plain `<FieldLegend>` is not a field and passes.
//    Instructions a person needs to fill the field go after the input; explanations go in the topic.
//
// 3. Drift. Each help file has a `<form>.help.sources.ts` naming the code every topic describes,
//    and `field-help.lock.json` holds the fingerprints reviewed last. A topic with no sources entry,
//    a target that does not resolve, or a fingerprint that differs from the lock fails, printing
//    only that topic's English hint and body and the changed targets. Editing the copy does not
//    clear it; `pnpm help:ack <topic> --reason "…"` does. Details: scripts/lib/field-help-drift.ts.
//
// No allowlist. Run via `pnpm check:field-help`.

import { type Dirent, existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { HELP_LIMITS } from '../libs/frontend/ui/src/form/help/field-help';
import {
  checkDrift,
  formatDrift,
  LOCK_FILE,
  parseLock,
  SOURCES_SUFFIX,
} from './lib/field-help-drift';

const ROOT = process.cwd();
const WEB_SRC = 'apps/web/src';
const HELP_DIR = 'apps/web/src/help';
const LOCALES = ['en', 'hi'] as const;
const HELP_TEXT_KEYS = ['title', 'body', 'hint', 'example', 'avoid'] as const;

export const INPUT_TAGS: ReadonlySet<string> = new Set([
  'input',
  'textarea',
  'select',
  'Input',
  'Textarea',
  'Select',
  'SelectTrigger',
  'Checkbox',
  'Switch',
  'RadioGroup',
  'Slider',
  'InputOTP',
  'Calendar',
  'Combobox',
  'PopoverTrigger',
  'Command',
]);
export const INPUT_SUFFIXES = [
  'Input',
  'Textarea',
  'Select',
  'Picker',
  'Selector',
  'Combobox',
  'Checkbox',
  'Switch',
  'Upload',
  'Builder',
  'Editor',
  'Field',
] as const;

export interface Problem {
  file: string;
  line: number;
  message: string;
}

export interface HelpTopic {
  file: string;
  line: number;
  exportName: string;
  key: string;
  id: string;
  /** English copy, printed by the drift check. */
  hint?: string;
  body?: string;
}

function parse(file: string, text: string, kind: ts.ScriptKind): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function propName(prop: ts.ObjectLiteralElementLike): string | null {
  if (!ts.isPropertyAssignment(prop)) return null;
  const name = prop.name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return null;
}

function stringValue(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/** `helpOptions<T>({ … })` and `{ … } satisfies X` both resolve to their object literal. */
function objectLiteral(node: ts.Expression): ts.ObjectLiteralExpression | null {
  if (ts.isObjectLiteralExpression(node)) return node;
  if (
    ts.isSatisfiesExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isParenthesizedExpression(node)
  )
    return objectLiteral(node.expression);
  if (ts.isCallExpression(node) && node.arguments.length === 1) {
    const [arg] = node.arguments;
    return arg ? objectLiteral(arg) : null;
  }
  return null;
}

function checkHelpText(
  source: ts.SourceFile,
  node: ts.Expression,
  where: string,
  limit: number | undefined,
): Problem[] {
  const file = source.fileName;
  const obj = objectLiteral(node);
  if (!obj) {
    return [
      { file, line: lineOf(source, node), message: `${where}: must be { en: '…', hi: '…' }` },
    ];
  }
  const problems: Problem[] = [];
  for (const locale of LOCALES) {
    const prop = obj.properties.find((p) => propName(p) === locale);
    const value = prop && ts.isPropertyAssignment(prop) ? stringValue(prop.initializer) : null;
    if (value === null) {
      problems.push({
        file,
        line: lineOf(source, obj),
        message: `${where}.${locale}: missing or not a string literal`,
      });
    } else if (value.trim() === '') {
      problems.push({ file, line: lineOf(source, obj), message: `${where}.${locale}: empty` });
    } else if (limit !== undefined && value.length > limit) {
      problems.push({
        file,
        line: lineOf(source, obj),
        message: `${where}.${locale}: ${value.length} characters, the limit is ${limit}`,
      });
    }
  }
  return problems;
}

function englishText(node: ts.Expression | undefined): string | undefined {
  const obj = node ? objectLiteral(node) : null;
  const prop = obj?.properties.find((p) => propName(p) === 'en');
  const value = prop && ts.isPropertyAssignment(prop) ? stringValue(prop.initializer) : null;
  return value ?? undefined;
}

function articleImport(node: ts.Expression): ts.StringLiteral | null {
  let found: ts.StringLiteral | null = null;
  const visit = (n: ts.Node): void => {
    if (
      !found &&
      ts.isCallExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ImportKeyword &&
      n.arguments[0] &&
      ts.isStringLiteral(n.arguments[0])
    ) {
      found = n.arguments[0];
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

interface TopicContext {
  source: ts.SourceFile;
  id: string;
  exists: (path: string) => boolean;
}

function topicFields(topic: ts.ObjectLiteralExpression): Map<string, ts.Expression> {
  const fields = new Map<string, ts.Expression>();
  for (const p of topic.properties) {
    const name = propName(p);
    if (name && ts.isPropertyAssignment(p)) fields.set(name, p.initializer);
  }
  return fields;
}

function checkPoints(ctx: TopicContext, points: ts.Expression): Problem[] {
  if (!ts.isArrayLiteralExpression(points)) {
    return [
      {
        file: ctx.source.fileName,
        line: lineOf(ctx.source, points),
        message: `${ctx.id}.points: must be an array literal`,
      },
    ];
  }
  return points.elements.flatMap((point, i) =>
    checkHelpText(ctx.source, point, `${ctx.id}.points[${i}]`, HELP_LIMITS.body),
  );
}

function checkOptions(ctx: TopicContext, options: ts.Expression): Problem[] {
  const optionsObj = objectLiteral(options);
  if (!optionsObj) {
    return [
      {
        file: ctx.source.fileName,
        line: lineOf(ctx.source, options),
        message: `${ctx.id}.options: must be an object literal`,
      },
    ];
  }
  return optionsObj.properties.flatMap((option) => {
    const optionKey = propName(option);
    if (!optionKey || !ts.isPropertyAssignment(option)) return [];
    return checkHelpText(
      ctx.source,
      option.initializer,
      `${ctx.id}.options.${optionKey}`,
      HELP_LIMITS.body,
    );
  });
}

function checkArticle(ctx: TopicContext, article: ts.Expression): Problem[] {
  const file = ctx.source.fileName;
  const line = lineOf(ctx.source, article);
  const specifier = articleImport(article);
  if (!specifier) {
    return [{ file, line, message: `${ctx.id}.article: must return import('./<file>')` }];
  }
  if (!ctx.exists(resolve(dirname(file), specifier.text))) {
    return [{ file, line, message: `${ctx.id}.article: ${specifier.text} does not exist` }];
  }
  return [];
}

function checkTopic(
  ctx: TopicContext,
  prop: ts.Node,
  topic: ts.ObjectLiteralExpression,
): Problem[] {
  const problems: Problem[] = [];
  const fields = topicFields(topic);
  for (const required of ['title', 'body'] as const) {
    if (!fields.has(required)) {
      problems.push({
        file: ctx.source.fileName,
        line: lineOf(ctx.source, prop),
        message: `${ctx.id}: no ${required}`,
      });
    }
  }
  for (const name of HELP_TEXT_KEYS) {
    const value = fields.get(name);
    if (!value) continue;
    const limit =
      name === 'hint' ? HELP_LIMITS.hint : name === 'body' ? HELP_LIMITS.body : undefined;
    problems.push(...checkHelpText(ctx.source, value, `${ctx.id}.${name}`, limit));
  }
  const options = fields.get('options');
  if (options) problems.push(...checkOptions(ctx, options));
  const points = fields.get('points');
  if (points) problems.push(...checkPoints(ctx, points));
  const article = fields.get('article');
  if (article) problems.push(...checkArticle(ctx, article));
  return problems;
}

function readDefineCall(
  source: ts.SourceFile,
  call: ts.CallExpression,
  exists: (path: string) => boolean,
): { topics: HelpTopic[]; problems: Problem[] } {
  const file = source.fileName;
  const [scopeArg, topicsArg] = call.arguments;
  const scope = scopeArg ? stringValue(scopeArg) : null;
  const topicsObj = topicsArg ? objectLiteral(topicsArg) : null;
  const declaration = call.parent;
  const exportName =
    ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)
      ? declaration.name.text
      : null;
  if (!scope || !topicsObj || !exportName) {
    return {
      topics: [],
      problems: [
        {
          file,
          line: lineOf(source, call),
          message:
            "defineFieldHelp must be `export const <name> = defineFieldHelp('<scope>', { … })`",
        },
      ],
    };
  }
  const topics: HelpTopic[] = [];
  const problems: Problem[] = [];
  for (const prop of topicsObj.properties) {
    const key = propName(prop);
    const topic = ts.isPropertyAssignment(prop) ? objectLiteral(prop.initializer) : null;
    if (!key || !topic) {
      problems.push({ file, line: lineOf(source, prop), message: 'topic must be `key: { … }`' });
      continue;
    }
    const id = `${scope}.${key}`;
    const fields = topicFields(topic);
    topics.push({
      file,
      line: lineOf(source, prop),
      exportName,
      key,
      id,
      hint: englishText(fields.get('hint')),
      body: englishText(fields.get('body')),
    });
    problems.push(...checkTopic({ source, id, exists }, prop, topic));
  }
  return { topics, problems };
}

/** Topics declared in one help file, and the problems in them. */
export function readHelpFile(
  file: string,
  text: string,
  exists: (path: string) => boolean,
): { topics: HelpTopic[]; problems: Problem[] } {
  const source = parse(file, text, ts.ScriptKind.TS);
  const topics: HelpTopic[] = [];
  const problems: Problem[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'defineFieldHelp'
    ) {
      const result = readDefineCall(source, node, exists);
      topics.push(...result.topics);
      problems.push(...result.problems);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { topics, problems };
}

/** `<name>.<key>` property accesses in `text`, for topic usage. */
export function findTopicReferences(file: string, text: string): Set<string> {
  const source = parse(file, text, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const refs = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      refs.add(`${node.expression.text}.${node.name.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return refs;
}

/** `Input` for `<Input>`; `form.Field` for `<form.Field>` (a form library wrapper, not the `Field` component). */
function tagName(node: ts.JsxOpeningLikeElement): string {
  return node.tagName.getText();
}

/** The last segment: `TextField` for `<field.TextField>`. */
function baseName(node: ts.JsxOpeningLikeElement): string {
  const name = node.tagName;
  return ts.isPropertyAccessExpression(name) ? name.name.text : name.getText();
}

const FORM_WRAPPERS = new Set(['Field', 'AppField', 'AppForm', 'Subscribe']);

function attribute(node: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  return node.attributes.properties.find(
    (a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText() === name,
  );
}

function literalAttribute(node: ts.JsxOpeningLikeElement, name: string): string | null {
  const attr = attribute(node, name);
  const init = attr?.initializer;
  if (!init) return null;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression) {
    const value = stringValue(init.expression);
    if (value !== null) return value;
    // cn('…', '…') and template literals: read the literal parts.
    return init.expression.getText();
  }
  return null;
}

function openingOf(node: ts.Node): ts.JsxOpeningLikeElement | null {
  if (ts.isJsxElement(node)) return node.openingElement;
  if (ts.isJsxSelfClosingElement(node)) return node;
  return null;
}

export function isInputLike(node: ts.JsxOpeningLikeElement): boolean {
  const name = tagName(node);
  if (name === 'Field' || name === 'FieldSet') return true;
  if (attribute(node, 'id')) return true;
  // `<form.Field>` / `<form.AppField>` only wrap a render function; what it renders decides.
  if (ts.isPropertyAccessExpression(node.tagName) && FORM_WRAPPERS.has(baseName(node)))
    return false;
  const base = baseName(node);
  if (INPUT_TAGS.has(base)) return true;
  return INPUT_SUFFIXES.some((suffix) => base !== suffix && base.endsWith(suffix));
}

function isHelpTextBeforeInput(node: ts.JsxOpeningLikeElement): boolean {
  const name = tagName(node);
  if (name === 'FieldDescription') return true;
  if (name === 'p')
    return (literalAttribute(node, 'className') ?? '').includes('text-muted-foreground');
  return false;
}

function isScope(node: ts.Node): boolean {
  const opening = openingOf(node);
  return opening !== null && ['Field', 'FieldSet'].includes(tagName(opening));
}

function isLabelFieldSet(element: ts.JsxElement): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || (node !== element && isScope(node))) return;
    const opening = openingOf(node);
    if (
      opening &&
      tagName(opening) === 'FieldLegend' &&
      literalAttribute(opening, 'variant') === 'label'
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  for (const child of element.children) visit(child);
  return found;
}

function endsInReturn(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement)) return true;
  if (ts.isBlock(statement)) {
    const last = statement.statements.at(-1);
    return last !== undefined && ts.isReturnStatement(last);
  }
  return false;
}

interface ScanState {
  /** Help text seen at the field's own level and not yet followed by an input. */
  pending: readonly ts.Node[];
  reached: boolean;
}

const LOGICAL_OPERATORS = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

/**
 * Text placed between a field's label and its input (rule 2). Text counts only at the field's
 * own level (not inside a nested element such as a drop zone or a horizontal field's
 * `FieldContent`), and only when an input follows it on the same render path: the two branches
 * of `a ? b : c` are alternatives, and a field with no input (a read-only value) passes.
 */
export function findTextBeforeInput(file: string, text: string): Problem[] {
  const source = parse(file, text, ts.ScriptKind.TSX);
  const flagged = new Set<ts.Node>();

  const either = (a: ScanState, b: ScanState): ScanState => ({
    pending: [...new Set([...a.pending, ...b.pending])],
    reached: a.reached && b.reached,
  });

  const walkAll = (nodes: readonly ts.Node[], direct: boolean, start: ScanState): ScanState => {
    let state = start;
    for (const [index, node] of nodes.entries()) {
      if (state.reached) return state;
      // `if (c) return a; …rest` renders a or rest, never both.
      if (ts.isIfStatement(node) && !node.elseStatement && endsInReturn(node.thenStatement)) {
        const a = walk(node.thenStatement, direct, state.pending);
        const b = walkAll(nodes.slice(index + 1), direct, {
          pending: state.pending,
          reached: false,
        });
        return either(a, b);
      }
      state = walk(node, direct, state.pending);
    }
    return state;
  };

  const walk = (node: ts.Node, direct: boolean, pending: readonly ts.Node[]): ScanState => {
    const opening = openingOf(node);
    if (opening) {
      if (isInputLike(opening)) {
        for (const n of pending) flagged.add(n);
        return { pending: [], reached: true };
      }
      if (direct && isHelpTextBeforeInput(opening)) {
        return { pending: [...pending, node], reached: false };
      }
      const children = ts.isJsxElement(node) ? [...node.children] : [];
      return walkAll(children, false, { pending, reached: false });
    }
    if (ts.isConditionalExpression(node)) {
      return either(walk(node.whenTrue, direct, pending), walk(node.whenFalse, direct, pending));
    }
    if (ts.isIfStatement(node) && node.elseStatement) {
      return either(
        walk(node.thenStatement, direct, pending),
        walk(node.elseStatement, direct, pending),
      );
    }
    if (ts.isBinaryExpression(node) && LOGICAL_OPERATORS.has(node.operatorToken.kind)) {
      const right = walk(node.right, direct, pending);
      return { pending: [...new Set([...pending, ...right.pending])], reached: false };
    }
    const children: ts.Node[] = [];
    ts.forEachChild(node, (child) => {
      children.push(child);
    });
    return walkAll(children, direct, { pending, reached: false });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node)) {
      const name = tagName(node.openingElement);
      if (name === 'Field' || (name === 'FieldSet' && isLabelFieldSet(node))) {
        walkAll([...node.children], true, { pending: [], reached: false });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return [...flagged]
    .map((node) => {
      const opening = openingOf(node);
      return {
        file,
        line: lineOf(source, node),
        message: `<${opening ? tagName(opening) : '?'}> between the label and the input: put an instruction after the input and an explanation in the field's help topic`,
      };
    })
    .sort((a, b) => a.line - b.line);
}

function walkFiles(dir: string, accept: (name: string) => boolean, out: string[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (['__tests__', 'node_modules', '.next', 'dist'].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, accept, out);
    else if (entry.isFile() && accept(entry.name)) out.push(full);
  }
}

/** Every problem in the help topics and their use across `apps/web/src`. */
export function checkTopics(
  helpFiles: ReadonlyArray<{ file: string; text: string }>,
  appFiles: ReadonlyArray<{ file: string; text: string }>,
  exists: (path: string) => boolean,
): Problem[] {
  const problems: Problem[] = [];
  const topics: HelpTopic[] = [];
  for (const { file, text } of helpFiles) {
    const result = readHelpFile(file, text, exists);
    topics.push(...result.topics);
    problems.push(...result.problems);
  }
  const byId = new Map<string, HelpTopic>();
  for (const topic of topics) {
    const first = byId.get(topic.id);
    if (first) {
      problems.push({
        file: topic.file,
        line: topic.line,
        message: `topic id ${topic.id} is also declared in ${first.file}:${first.line}`,
      });
    } else {
      byId.set(topic.id, topic);
    }
  }
  const used = new Set<string>();
  for (const { file, text } of appFiles) {
    if (text.includes('defineFieldHelp(') && !/apps\/web\/src\/help\//.test(file)) {
      problems.push({ file, line: 1, message: `defineFieldHelp belongs in ${HELP_DIR}/` });
    }
    for (const ref of findTopicReferences(file, text)) used.add(ref);
  }
  for (const topic of topics) {
    if (!used.has(`${topic.exportName}.${topic.key}`)) {
      problems.push({
        file: topic.file,
        line: topic.line,
        message: `topic ${topic.id} is not used by any field (${topic.exportName}.${topic.key})`,
      });
    }
  }
  return problems;
}

function read(paths: string[]): Array<{ file: string; text: string }> {
  return paths.map((path) => ({ file: relative(ROOT, path), text: readFileSync(path, 'utf8') }));
}

/** Help files, their sources files, and the app files that use them. */
export function loadFieldHelp(root: string) {
  const helpPaths: string[] = [];
  walkFiles(
    join(root, HELP_DIR),
    (name) => name.endsWith('.ts') && !name.endsWith(SOURCES_SUFFIX),
    helpPaths,
  );
  const sourcesPaths: string[] = [];
  walkFiles(join(root, HELP_DIR), (name) => name.endsWith(SOURCES_SUFFIX), sourcesPaths);
  const appPaths: string[] = [];
  walkFiles(
    join(root, WEB_SRC),
    (name) => (name.endsWith('.ts') || name.endsWith('.tsx')) && !name.endsWith('.d.ts'),
    appPaths,
  );
  const helpFiles = read(helpPaths.sort());
  const sourcesFiles = read(sourcesPaths.sort());
  const helpSet = new Set([...helpFiles, ...sourcesFiles].map((f) => f.file));
  const appFiles = read(appPaths.sort()).filter((f) => !helpSet.has(f.file));
  const topics = helpFiles.flatMap(({ file, text }) => readHelpFile(file, text, () => true).topics);
  return { helpFiles, sourcesFiles, appFiles, topics };
}

export function readRepoFile(path: string): string | null {
  const full = resolve(ROOT, path);
  return existsSync(full) ? readFileSync(full, 'utf8') : null;
}

function main(): void {
  const { helpFiles, sourcesFiles, appFiles, topics } = loadFieldHelp(ROOT);

  const problems = [
    ...checkTopics(helpFiles, appFiles, (path) =>
      ['', '.ts', '.tsx'].some((ext) => existsSync(resolve(ROOT, `${path}${ext}`))),
    ),
    ...appFiles
      .filter((f) => f.file.endsWith('.tsx'))
      .flatMap(({ file, text }) => findTextBeforeInput(file, text)),
  ];
  const { problems: driftProblems, drift } = checkDrift(
    topics,
    sourcesFiles,
    parseLock(readRepoFile(LOCK_FILE)),
    readRepoFile,
  );
  problems.push(...driftProblems);

  if (problems.length > 0) {
    console.error('check:field-help found problems:\n');
    for (const p of problems) console.error(`  ${p.file}:${p.line}  ${p.message}`);
    console.error(
      `\n${problems.length} problem(s). See docs/frontend.md → "Field help" and .claude/skills/frontend-ux/SKILL.md [DNMPQ].`,
    );
    if (drift.length > 0) console.error(`\n${formatDrift(drift)}`);
    process.exit(1);
  }
  if (drift.length > 0) {
    console.error(`check:field-help: ${formatDrift(drift)}`);
    process.exit(1);
  }
  console.log(
    `check:field-help OK (${helpFiles.length} help file(s), ${appFiles.length} app file(s))`,
  );
}

if (process.argv[1]?.endsWith('check-field-help.ts')) main();
