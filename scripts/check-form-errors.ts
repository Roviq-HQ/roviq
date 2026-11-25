// CI guard: a form's submit errors show in the form, not in a toast (ROV-357).
//
// A violation is a `toast.error(…)` call inside the `onSubmit` or `onSubmitInvalid` of the object
// literal passed as first argument to `useAppForm(…)` or `useForm(…)`, in any `.ts`/`.tsx` file
// under `apps/web/src` (not `__tests__`, `*.spec.*`, `*.generated.ts`). "Inside" is lexical: nested
// functions, try/catch and callbacks in the handler count. A handler written as a name
// (`onSubmit: handleSave`, `{ onSubmit }`) is looked up among the same file's function
// declarations and `const` initializers, and that whole declaration is scanned too.
//
// Instead: a rejection of one field → `setServerFieldError`; a failure of the whole submit →
// `setFormSubmitError` with `<form.SubmitError />` above the submit button (`@roviq/ui`). See
// docs/frontend.md → "Error messages".
//
// Baseline: `scripts/form-errors-baseline.json` maps each file that still has violations to its
// count. A file missing from it, or above its count, fails; a file below its count (or clean, or
// deleted) also fails until the entry is lowered or removed, so the list only shrinks.
// `--write-baseline` rewrites the file from the current code: it was used for the initial list
// and is for lowering counts only, never for adding a file or raising a count.
//
// Run via `pnpm check:form-errors`.

import { type Dirent, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();
const WEB_SRC = 'apps/web/src';
export const BASELINE_FILE = 'scripts/form-errors-baseline.json';

const FORM_HOOKS: ReadonlySet<string> = new Set(['useAppForm', 'useForm']);
const HANDLERS: ReadonlySet<string> = new Set(['onSubmit', 'onSubmitInvalid']);

export const FIX_HINT =
  'Show a rejection of one field with setServerFieldError, and a failure of the whole submit with ' +
  'setFormSubmitError and <form.SubmitError /> above the submit button (docs/frontend.md → "Error messages").';

export interface Violation {
  file: string;
  line: number;
}

export type Baseline = Record<string, number>;

function parse(file: string, text: string): ts.SourceFile {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

function calleeName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

function isToastError(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'toast' &&
    callee.name.text === 'error'
  );
}

/** Same-file declarations a handler name can refer to: functions and `const` initializers. */
function declarationsByName(source: ts.SourceFile): Map<string, ts.Node[]> {
  const byName = new Map<string, ts.Node[]>();
  const add = (name: string, node: ts.Node) =>
    byName.set(name, [...(byName.get(name) ?? []), node]);
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) add(node.name.text, node.body);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      add(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return byName;
}

/** The nodes whose bodies count as the handler: inline code, or the declaration a name points to. */
function handlerBodies(
  property: ts.ObjectLiteralElementLike,
  declarations: Map<string, ts.Node[]>,
): ts.Node[] {
  if (ts.isMethodDeclaration(property)) return property.body ? [property.body] : [];
  if (ts.isShorthandPropertyAssignment(property)) {
    return declarations.get(property.name.text) ?? [];
  }
  if (!ts.isPropertyAssignment(property)) return [];
  const value = property.initializer;
  if (ts.isIdentifier(value)) return declarations.get(value.text) ?? [];
  return [value];
}

function propertyName(property: ts.ObjectLiteralElementLike): string | null {
  const name = property.name;
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return null;
}

/** Every `toast.error` a form's submit handlers reach in this file, sorted by line. */
export function findFormToastErrors(file: string, text: string): Violation[] {
  const source = parse(file, text);
  const declarations = declarationsByName(source);
  const hits = new Set<ts.CallExpression>();

  const collect = (node: ts.Node): void => {
    if (isToastError(node)) hits.add(node);
    ts.forEachChild(node, collect);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      const options = node.arguments[0];
      if (name && FORM_HOOKS.has(name) && options && ts.isObjectLiteralExpression(options)) {
        for (const property of options.properties) {
          const key = propertyName(property);
          if (!key || !HANDLERS.has(key)) continue;
          for (const body of handlerBodies(property, declarations)) collect(body);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return [...hits]
    .map((call) => ({
      file,
      line: source.getLineAndCharacterOfPosition(call.getStart(source)).line + 1,
    }))
    .sort((a, b) => a.line - b.line);
}

/** Groups violations by file. Files without violations are left out. */
export function countByFile(violations: readonly Violation[]): Map<string, Violation[]> {
  const byFile = new Map<string, Violation[]>();
  for (const v of violations) byFile.set(v.file, [...(byFile.get(v.file) ?? []), v]);
  return byFile;
}

/** Failure messages, one block per file, comparing the code with the baseline. */
export function compareWithBaseline(
  found: ReadonlyMap<string, readonly Violation[]>,
  baseline: Baseline,
): string[] {
  const failures: string[] = [];
  const sites = (violations: readonly Violation[]) =>
    violations.map((v) => `    ${v.file}:${v.line}`).join('\n');

  const files = [...new Set([...found.keys(), ...Object.keys(baseline)])].sort();
  for (const file of files) {
    const violations = found.get(file) ?? [];
    const allowed = baseline[file];
    const count = violations.length;
    if (allowed === undefined) {
      failures.push(
        `  ${file}: ${count} toast.error in a form's submit handler (file not in the baseline).\n` +
          `${sites(violations)}\n    ${FIX_HINT}`,
      );
    } else if (count > allowed) {
      failures.push(
        `  ${file}: ${count} toast.error in a form's submit handler, baseline allows ${allowed}.\n` +
          `${sites(violations)}\n    ${FIX_HINT}`,
      );
    } else if (count < allowed) {
      const fix =
        count === 0
          ? `remove its entry from ${BASELINE_FILE}`
          : `lower its entry in ${BASELINE_FILE} to ${count}`;
      failures.push(
        `  ${file}: ${count} toast.error in a form's submit handler, baseline says ${allowed}. ` +
          `Good: ${fix} (or run pnpx tsx scripts/check-form-errors.ts --write-baseline).`,
      );
    }
  }
  return failures;
}

/** The baseline the current code would produce, sorted by path. */
export function buildBaseline(found: ReadonlyMap<string, readonly Violation[]>): Baseline {
  const baseline: Baseline = {};
  for (const file of [...found.keys()].sort()) {
    const count = found.get(file)?.length ?? 0;
    if (count > 0) baseline[file] = count;
  }
  return baseline;
}

export function parseBaseline(text: string | null): Baseline {
  if (text === null) return {};
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${BASELINE_FILE} must be an object of "<path>": <count>`);
  }
  const baseline: Baseline = {};
  for (const [file, count] of Object.entries(parsed)) {
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
      throw new Error(`${BASELINE_FILE}: "${file}" must map to a positive whole number`);
    }
    baseline[file] = count;
  }
  return baseline;
}

function isScanned(name: string): boolean {
  return (
    (name.endsWith('.ts') || name.endsWith('.tsx')) &&
    !name.endsWith('.d.ts') &&
    !name.endsWith('.generated.ts') &&
    !/\.spec\.tsx?$/.test(name)
  );
}

function walkFiles(dir: string, out: string[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (['__tests__', 'node_modules', '.next', 'dist'].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else if (entry.isFile() && isScanned(entry.name)) out.push(full);
  }
}

/** Every violation under `apps/web/src`, by repo-relative path. */
export function scanWeb(root: string): Map<string, Violation[]> {
  const paths: string[] = [];
  walkFiles(join(root, WEB_SRC), paths);
  const violations = paths
    .sort()
    .flatMap((path) => findFormToastErrors(relative(root, path), readFileSync(path, 'utf8')));
  return countByFile(violations);
}

function main(): void {
  const found = scanWeb(ROOT);
  const baselinePath = resolve(ROOT, BASELINE_FILE);

  if (process.argv.includes('--write-baseline')) {
    const baseline = buildBaseline(found);
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    const total = Object.values(baseline).reduce((sum, n) => sum + n, 0);
    console.log(
      `check:form-errors: wrote ${BASELINE_FILE} (${Object.keys(baseline).length} file(s), ${total} call(s))`,
    );
    return;
  }

  const baseline = parseBaseline(
    existsSync(baselinePath) ? readFileSync(baselinePath, 'utf8') : null,
  );
  const failures = compareWithBaseline(found, baseline);
  if (failures.length > 0) {
    console.error('check:form-errors found problems:\n');
    for (const failure of failures) console.error(failure);
    console.error(
      `\n${failures.length} file(s). Submit errors belong in the form: see docs/frontend.md → "Error messages".`,
    );
    process.exit(1);
  }
  const total = Object.values(baseline).reduce((sum, n) => sum + n, 0);
  console.log(
    `check:form-errors OK (${Object.keys(baseline).length} file(s) in the baseline, ${total} toast.error call(s) left to move)`,
  );
}

if (process.argv[1]?.endsWith('check-form-errors.ts')) main();
