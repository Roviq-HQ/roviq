// Drift check for field help (ROV-347), used by `pnpm check:field-help` and `pnpm help:ack`.
//
// Each help file `<form>.help.ts` has a sibling `<form>.help.sources.ts` listing, per topic, the
// code the topic describes: `path`, `path#Symbol` or `path#Symbol.member[.member…]`, relative to
// the repository root. `field-help.lock.json` holds a fingerprint of every target per topic and
// the reason given when it was last reviewed. A target whose fingerprint changed fails the check
// until someone reads the topic and runs `pnpm help:ack <topic> --reason "…"`.
//
// Fingerprint of a TypeScript target: the declaration's tokens joined by one space, with comments
// and JSDoc dropped, JSX text whitespace collapsed, string literals re-quoted, `;` dropped, a comma
// before a closing bracket dropped and parentheses around JSX dropped, so a reformat or a comment
// does not count as a change. Other files: the text with whitespace runs collapsed and whitespace
// next to punctuation removed.

import { createHash } from 'node:crypto';
import ts from 'typescript';

export const LOCK_FILE = 'apps/web/src/help/field-help.lock.json';
export const SOURCES_SUFFIX = '.help.sources.ts';
const HELP_SUFFIX = '.help.ts';

export interface DriftProblem {
  file: string;
  line: number;
  message: string;
}

export interface TopicCopy {
  id: string;
  key: string;
  file: string;
  line: number;
  hint?: string;
  body?: string;
}

export interface SourcesEntry {
  key: string;
  line: number;
  targets: string[];
}

export interface LockEntry {
  reviewedReason: string;
  targets: Record<string, string>;
}

export type Lock = Record<string, LockEntry>;
export type ReadFile = (path: string) => string | null;

export interface Drift {
  topic: TopicCopy;
  changed: string[];
  /** False when the lock has no entry for the topic yet. */
  reviewedBefore: boolean;
}

export function sourcesFileFor(helpFile: string): string {
  return helpFile.replace(/\.help\.ts$/, SOURCES_SUFFIX);
}

export function helpFileFor(sourcesFile: string): string {
  return sourcesFile.slice(0, -SOURCES_SUFFIX.length) + HELP_SUFFIX;
}

function parse(file: string, text: string): ts.SourceFile {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

function unwrap(node: ts.Expression): ts.Expression {
  if (
    ts.isSatisfiesExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isParenthesizedExpression(node)
  )
    return unwrap(node.expression);
  return node;
}

/** Top-level `const NAME = '…'` strings, for targets written as `${NAME}/…`. */
function stringConstants(source: ts.SourceFile): Map<string, string> {
  const constants = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      const value = decl.initializer ? staticString(decl.initializer, constants) : null;
      if (ts.isIdentifier(decl.name) && value !== null) constants.set(decl.name.text, value);
    }
  }
  return constants;
}

function staticString(node: ts.Expression, constants: Map<string, string>): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isIdentifier(node)) return constants.get(node.text) ?? null;
  if (!ts.isTemplateExpression(node)) return null;
  let text = node.head.text;
  for (const span of node.templateSpans) {
    const value = staticString(span.expression, constants);
    if (value === null) return null;
    text += value + span.literal.text;
  }
  return text;
}

function propKey(prop: ts.ObjectLiteralElementLike): string | null {
  if (!ts.isPropertyAssignment(prop)) return null;
  return ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : null;
}

function readEntry(
  prop: ts.ObjectLiteralElementLike,
  constants: Map<string, string>,
  at: (node: ts.Node) => { file: string; line: number },
): { entry: SourcesEntry | null; problems: DriftProblem[] } {
  const key = propKey(prop);
  const list = key && ts.isPropertyAssignment(prop) ? unwrap(prop.initializer) : null;
  if (!key || !list || !ts.isArrayLiteralExpression(list)) {
    return {
      entry: null,
      problems: [{ ...at(prop), message: "sources entry must be `key: ['…']`" }],
    };
  }
  const problems: DriftProblem[] = [];
  const targets: string[] = [];
  for (const el of list.elements) {
    const target = staticString(el, constants);
    if (target !== null) targets.push(target);
    else {
      problems.push({
        ...at(el),
        message: 'a target must be a string, or a template of file-level string constants',
      });
    }
  }
  if (targets.length === 0) problems.push({ ...at(prop), message: `${key}: no targets` });
  return { entry: { key, line: at(prop).line, targets }, problems };
}

function sourcesObjects(source: ts.SourceFile): ts.ObjectLiteralExpression[] {
  return source.statements.filter(ts.isVariableStatement).flatMap((statement) =>
    statement.declarationList.declarations.flatMap((decl) => {
      const init = decl.initializer ? unwrap(decl.initializer) : null;
      return init && ts.isObjectLiteralExpression(init) ? [init] : [];
    }),
  );
}

/** The `{ key: ['target', …] }` object of a sources file. */
export function readSourcesFile(
  file: string,
  text: string,
): { entries: SourcesEntry[]; problems: DriftProblem[] } {
  const source = parse(file, text);
  const at = (node: ts.Node) => ({
    file,
    line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
  });
  const constants = stringConstants(source);
  const objects = sourcesObjects(source);
  if (objects.length === 0) {
    return {
      entries: [],
      problems: [
        {
          file,
          line: 1,
          message: 'expected `export const <name> = { … } satisfies HelpSources<typeof <help>>`',
        },
      ],
    };
  }
  const entries: SourcesEntry[] = [];
  const problems: DriftProblem[] = [];
  for (const prop of objects.flatMap((obj) => [...obj.properties])) {
    const result = readEntry(prop, constants, at);
    if (result.entry) entries.push(result.entry);
    problems.push(...result.problems);
  }
  return { entries, problems };
}

function isJsDoc(node: ts.Node): boolean {
  return node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;
}

function isJsx(node: ts.Node): boolean {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node);
}

function collectTokens(node: ts.Node, source: ts.SourceFile, out: string[]): void {
  if (isJsDoc(node)) return;
  if (ts.isParenthesizedExpression(node) && isJsx(node.expression)) {
    collectTokens(node.expression, source, out);
    return;
  }
  if (ts.isStringLiteral(node)) {
    out.push(JSON.stringify(node.text));
    return;
  }
  const children = node.getChildren(source);
  if (children.length > 0) {
    for (const child of children) collectTokens(child, source, out);
    return;
  }
  if (node.kind === ts.SyntaxKind.EndOfFileToken) return;
  const text =
    node.kind === ts.SyntaxKind.JsxText
      ? node.getText(source).replace(/\s+/g, ' ').trim()
      : node.getText(source);
  if (text) out.push(text);
}

const CLOSERS = new Set([')', ']', '}', '>']);

export function normalisedTokens(node: ts.Node, source: ts.SourceFile): string {
  const raw: string[] = [];
  collectTokens(node, source, raw);
  const kept = raw.filter((token, i) => {
    if (token === ';') return false;
    if (token === ',') return !CLOSERS.has(raw[i + 1] ?? '');
    return true;
  });
  return kept.join(' ');
}

function nameOf(node: ts.Node): string | null {
  const name = (node as { name?: ts.Node }).name;
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name)) {
    return name.text;
  }
  return null;
}

function isNamedDeclaration(node: ts.Node): boolean {
  return (
    ts.isPropertyAssignment(node) ||
    ts.isShorthandPropertyAssignment(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isPropertySignature(node) ||
    ts.isMethodSignature(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isEnumMember(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isVariableDeclaration(node)
  );
}

function findTopLevel(source: ts.SourceFile, name: string): ts.Node | null {
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name) return decl;
      }
    } else if (nameOf(statement) === name) {
      return statement;
    }
  }
  return null;
}

/** The shallowest named declaration `name` inside `root`. */
function findMember(root: ts.Node, name: string, source: ts.SourceFile): ts.Node | null {
  let level: readonly ts.Node[] = root.getChildren(source);
  while (level.length > 0) {
    for (const node of level) {
      if (isNamedDeclaration(node) && nameOf(node) === name) return node;
    }
    level = level.flatMap((node) => node.getChildren(source));
  }
  return null;
}

export function fingerprintTarget(
  target: string,
  read: ReadFile,
): { hash: string } | { error: string } {
  const [path, symbol] = target.split('#', 2);
  if (!path) return { error: `${target}: no file` };
  const text = read(path);
  if (text === null) return { error: `${target}: file not found` };
  const isTs = /\.(ts|tsx|mts|cts)$/.test(path);
  if (!isTs) {
    if (symbol) return { error: `${target}: a symbol can only be named in a TypeScript file` };
    return { hash: hash(normalisedText(text)) };
  }
  const source = parse(path, text);
  if (!symbol) return { hash: hash(normalisedTokens(source, source)) };
  const [first, ...members] = symbol.split('.');
  let node = first ? findTopLevel(source, first) : null;
  for (const member of members) {
    if (!node) break;
    node = findMember(node, member, source);
  }
  if (!node) return { error: `${target}: symbol not found` };
  return { hash: hash(normalisedTokens(node, source)) };
}

function normalisedText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s*([()[\]{},;:=<>])\s*/g, '$1')
    .trim();
}

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/** Topics and their targets, plus problems in how they are paired. */
export function pairTopics(
  topics: readonly TopicCopy[],
  sourcesFiles: ReadonlyArray<{ file: string; text: string }>,
): {
  targets: Map<string, { targets: string[]; file: string; line: number }>;
  problems: DriftProblem[];
} {
  const problems: DriftProblem[] = [];
  const targets = new Map<string, { targets: string[]; file: string; line: number }>();
  const byHelpFile = new Map<string, TopicCopy[]>();
  for (const topic of topics) {
    byHelpFile.set(topic.file, [...(byHelpFile.get(topic.file) ?? []), topic]);
  }
  const readSources = new Map<string, SourcesEntry[]>();
  for (const { file, text } of sourcesFiles) {
    const result = readSourcesFile(file, text);
    problems.push(...result.problems);
    readSources.set(file, result.entries);
    if (!byHelpFile.has(helpFileFor(file))) {
      problems.push({ file, line: 1, message: `no help file ${helpFileFor(file)}` });
    }
  }
  for (const [helpFile, fileTopics] of byHelpFile) {
    const sourcesFile = sourcesFileFor(helpFile);
    const entries = readSources.get(sourcesFile);
    const byKey = new Map((entries ?? []).map((entry) => [entry.key, entry]));
    for (const topic of fileTopics) {
      const entry = byKey.get(topic.key);
      if (!entry) {
        problems.push({
          file: topic.file,
          line: topic.line,
          message: `${topic.id}: no sources entry in ${sourcesFile}`,
        });
        continue;
      }
      targets.set(topic.id, { targets: entry.targets, file: sourcesFile, line: entry.line });
    }
    const keys = new Set(fileTopics.map((topic) => topic.key));
    for (const entry of entries ?? []) {
      if (!keys.has(entry.key)) {
        problems.push({
          file: sourcesFile,
          line: entry.line,
          message: `${entry.key}: not a topic of ${helpFile}`,
        });
      }
    }
  }
  return { targets, problems };
}

function fingerprints(
  targetList: readonly string[],
  read: ReadFile,
): { hashes: Record<string, string>; errors: string[] } {
  const hashes: Record<string, string> = {};
  const errors: string[] = [];
  for (const target of targetList) {
    const result = fingerprintTarget(target, read);
    if ('hash' in result) hashes[target] = result.hash;
    else errors.push(result.error);
  }
  return { hashes, errors };
}

/** Problems (unresolved targets, pairing, stale lock entries) and topics whose code changed. */
export function checkDrift(
  topics: readonly TopicCopy[],
  sourcesFiles: ReadonlyArray<{ file: string; text: string }>,
  lock: Lock,
  read: ReadFile,
): { problems: DriftProblem[]; drift: Drift[] } {
  const { targets, problems } = pairTopics(topics, sourcesFiles);
  const drift: Drift[] = [];
  for (const topic of topics) {
    const paired = targets.get(topic.id);
    if (!paired) continue;
    const { hashes, errors } = fingerprints(paired.targets, read);
    for (const error of errors) {
      problems.push({ file: paired.file, line: paired.line, message: `${topic.id}: ${error}` });
    }
    if (errors.length > 0) continue;
    const entry = lock[topic.id];
    const reviewed = entry?.targets ?? {};
    const changed = [
      ...Object.keys(hashes).filter((target) => reviewed[target] !== hashes[target]),
      ...Object.keys(reviewed)
        .filter((target) => !(target in hashes))
        .map((target) => `${target} (removed)`),
    ];
    if (changed.length > 0) drift.push({ topic, changed, reviewedBefore: entry !== undefined });
  }
  const ids = new Set(topics.map((topic) => topic.id));
  for (const id of Object.keys(lock)) {
    if (!ids.has(id)) {
      problems.push({
        file: LOCK_FILE,
        line: 1,
        message: `${id}: no such topic; \`pnpm help:ack\` on any topic removes it`,
      });
    }
  }
  return { problems, drift };
}

/** The lock after reviewing `ids`, or why it cannot be written. */
export function ackTopics(params: {
  ids: readonly string[];
  reason: string;
  topics: readonly TopicCopy[];
  sourcesFiles: ReadonlyArray<{ file: string; text: string }>;
  lock: Lock;
  read: ReadFile;
}): { lock: Lock; pruned: string[] } | { error: string } {
  const reason = params.reason.trim();
  if (!reason) return { error: 'a --reason saying what was checked is required' };
  const { targets, problems } = pairTopics(params.topics, params.sourcesFiles);
  const known = new Set(params.topics.map((topic) => topic.id));
  const unknown = params.ids.filter((id) => !known.has(id));
  if (unknown.length > 0) return { error: `unknown topic: ${unknown.join(', ')}` };
  const next: Lock = {};
  const pruned: string[] = [];
  for (const [id, entry] of Object.entries(params.lock)) {
    if (known.has(id)) next[id] = entry;
    else pruned.push(id);
  }
  for (const id of params.ids) {
    const paired = targets.get(id);
    if (!paired) {
      const why = problems.find((p) => p.message.startsWith(`${id}:`));
      return { error: why ? why.message : `${id}: no sources entry` };
    }
    const { hashes, errors } = fingerprints(paired.targets, params.read);
    if (errors.length > 0) return { error: errors.map((e) => `${id}: ${e}`).join('\n') };
    next[id] = { reviewedReason: reason, targets: hashes };
  }
  return { lock: next, pruned };
}

/** Sorted keys at every level, so a review changes only its own lines. */
export function serializeLock(lock: Lock): string {
  const sorted: Lock = {};
  for (const id of Object.keys(lock).sort()) {
    const entry = lock[id];
    if (!entry) continue;
    const targets: Record<string, string> = {};
    for (const target of Object.keys(entry.targets).sort()) {
      const value = entry.targets[target];
      if (value !== undefined) targets[target] = value;
    }
    sorted[id] = { reviewedReason: entry.reviewedReason, targets };
  }
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

export function parseLock(text: string | null): Lock {
  if (!text) return {};
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  return parsed as Lock;
}

export function formatDrift(drift: readonly Drift[]): string {
  const lines = [
    `The code behind ${drift.length} help topic(s) changed since the help was last reviewed.`,
    'Read each topic; if the behaviour changed, edit its copy (en and hi). Then run',
    '  pnpm help:ack <topic> --reason "<what you checked>"',
    '',
  ];
  for (const { topic, changed, reviewedBefore } of drift) {
    lines.push(`  ${topic.id}  (${topic.file}:${topic.line})`);
    if (topic.hint) lines.push(`    hint: ${topic.hint}`);
    if (topic.body) lines.push(`    body: ${topic.body}`);
    const label = reviewedBefore ? 'changed' : 'not reviewed yet';
    for (const target of changed) lines.push(`    ${label}: ${target}`);
  }
  return lines.join('\n');
}
