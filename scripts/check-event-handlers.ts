// CI guard — a NestJS `@EventPattern` / `@MessagePattern` handler only receives messages when
// (a) its class is in a module's `controllers` (Nest scans only controllers for patterns) and
// (b) the app's `main.ts` connects the transport through `connectJetStreamMicroservice()`. Without
// either, the handler compiles, its events reach NATS, and nothing consumes them (ROV-316). A bare
// `app.connectMicroservice()` does not count: it skips the filter that keeps a handler's real error
// for the dead-letter entry (ROV-321).
//
// An `ee/apps/<name>` handler is hosted by `apps/<name>`: modules of both count, and the
// `main.ts` is `apps/<name>/src/main.ts`.

import { type Dirent, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();
const PATTERN_DECORATORS = new Set(['EventPattern', 'MessagePattern']);

export interface HandlerClass {
  className: string;
  file: string;
}

export interface Violation {
  file: string;
  className: string;
  reason: string;
}

function decoratorName(decorator: ts.Decorator): string | null {
  const expr = decorator.expression;
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) return expr.expression.text;
  if (ts.isIdentifier(expr)) return expr.text;
  return null;
}

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** Classes in `text` with at least one method decorated with a message-pattern decorator. */
export function findHandlerClasses(file: string, text: string): HandlerClass[] {
  const found: HandlerClass[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name) {
      const hasPattern = node.members.some(
        (member) =>
          ts.isMethodDeclaration(member) &&
          (ts.getDecorators(member) ?? []).some((d) =>
            PATTERN_DECORATORS.has(decoratorName(d) ?? ''),
          ),
      );
      if (hasPattern) found.push({ className: node.name.text, file });
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file, text));
  return found;
}

/** Identifiers listed in the `controllers: [...]` of every `@Module({...})` in `text`. */
function controllersArray(decorator: ts.Decorator): ts.ArrayLiteralExpression | null {
  if (decoratorName(decorator) !== 'Module' || !ts.isCallExpression(decorator.expression)) {
    return null;
  }
  const [arg] = decorator.expression.arguments;
  if (!arg || !ts.isObjectLiteralExpression(arg)) return null;
  for (const prop of arg.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === 'controllers' &&
      ts.isArrayLiteralExpression(prop.initializer)
    ) {
      return prop.initializer;
    }
  }
  return null;
}

export function findModuleControllers(file: string, text: string): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    const array = ts.isDecorator(node) ? controllersArray(node) : null;
    for (const el of array?.elements ?? []) {
      if (ts.isIdentifier(el)) names.add(el.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file, text));
  return names;
}

/** Whether `main.ts` calls `connectJetStreamMicroservice(...)` from `@roviq/nats-jetstream`. */
export function connectsJetStream(file: string, text: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'connectJetStreamMicroservice'
    ) {
      found = true;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(parse(file, text));
  return found;
}

export interface AppSources {
  /** The host app's `src/main.ts` text, or null when it has none. */
  mainText: string | null;
  mainPath: string;
  /** Every non-test `.ts` file of the app (and of its `ee/` twin). */
  files: { path: string; text: string }[];
}

export function checkApp(app: AppSources): Violation[] {
  const handlers = app.files.flatMap((f) => findHandlerClasses(f.path, f.text));
  if (handlers.length === 0) return [];
  const controllers = new Set<string>();
  for (const f of app.files) {
    for (const name of findModuleControllers(f.path, f.text)) controllers.add(name);
  }
  const connected = app.mainText !== null && connectsJetStream(app.mainPath, app.mainText);

  const violations: Violation[] = [];
  for (const h of handlers) {
    if (!controllers.has(h.className)) {
      violations.push({
        ...h,
        reason:
          'is not in any `controllers: [...]` of a module of this app (Nest only scans controllers for message patterns)',
      });
    }
    if (!connected) {
      violations.push({
        ...h,
        reason: `has message-pattern handlers but ${app.mainPath} never calls connectJetStreamMicroservice()`,
      });
    }
  }
  return violations;
}

function walk(dir: string, out: string[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = entry.name;
    if (name === 'node_modules' || name === 'dist' || name === '.next' || name.startsWith('.'))
      continue;
    const full = join(dir, name);
    if (entry.isDirectory()) {
      if (name === '__tests__' || name === '__generated__') continue;
      walk(full, out);
    } else if (entry.isFile() && name.endsWith('.ts') && !name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
}

function appNames(): string[] {
  const names = new Set<string>();
  for (const base of ['apps', 'ee/apps']) {
    const dir = join(ROOT, base);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) names.add(entry.name);
    }
  }
  return [...names].sort();
}

function loadApp(name: string): AppSources {
  const paths: string[] = [];
  for (const base of ['apps', 'ee/apps']) walk(join(ROOT, base, name, 'src'), paths);
  const mainAbs = join(ROOT, 'apps', name, 'src', 'main.ts');
  const rel = (p: string) => relative(ROOT, p).replace(/\\/g, '/');
  return {
    mainPath: rel(mainAbs),
    mainText: existsSync(mainAbs) ? readFileSync(mainAbs, 'utf8') : null,
    files: paths.map((p) => ({ path: rel(p), text: readFileSync(p, 'utf8') })),
  };
}

function main(): number {
  const violations = appNames().flatMap((name) => checkApp(loadApp(name)));
  if (violations.length === 0) {
    process.stdout.write(
      'check:event-handlers — every @EventPattern/@MessagePattern class is a controller of an app with a connected microservice.\n',
    );
    return 0;
  }
  process.stderr.write(
    `check:event-handlers — ${violations.length} message handler(s) that would never run:\n\n`,
  );
  for (const v of violations) {
    process.stderr.write(`  ${v.file}: ${v.className} ${v.reason}\n`);
  }
  process.stderr.write(
    '\nMove the class from `providers` to `controllers` of its module, and connect the transport in main.ts\n' +
      '(connectJetStreamMicroservice(app, { servers, streams, dlq }) + app.startAllMicroservices()).\n',
  );
  return 1;
}

if (process.argv[1]?.endsWith('check-event-handlers.ts')) {
  process.exit(main());
}
