// Method-level reach for `check:admin-context-reach`: which functions that open
// the admin DB context can be called, directly or through other code, from a
// resolver method.

import { relative } from 'node:path';
import ts from 'typescript';

const ADMIN_CONTEXT_RE = /\b(mkAdminCtx|withAdmin)\(/;

type Callable =
  | ts.MethodDeclaration
  | ts.FunctionDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression;

function isCallable(node: ts.Node): node is Callable {
  return (
    ts.isMethodDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node)
  );
}

function isTestFile(path: string): boolean {
  return path.includes('/__tests__/') || /\.spec\.tsx?$/.test(path);
}

/** `Class.method`, `functionName`, or the variable or property an arrow function is assigned to. */
function nameOf(fn: Callable): string | undefined {
  if (ts.isMethodDeclaration(fn)) {
    const owner = ts.isClassLike(fn.parent) ? fn.parent.name?.text : undefined;
    return owner ? `${owner}.${fn.name.getText()}` : fn.name.getText();
  }
  if (ts.isFunctionDeclaration(fn)) return fn.name?.text;
  const holder = fn.parent;
  if (ts.isVariableDeclaration(holder)) return holder.name.getText();
  if (ts.isPropertyDeclaration(holder)) {
    const owner = ts.isClassLike(holder.parent) ? holder.parent.name?.text : undefined;
    return owner ? `${owner}.${holder.name.getText()}` : holder.name.getText();
  }
  return undefined;
}

/**
 * Admin-context functions reachable from the methods of the classes declared in
 * `roots`, mapped to the first root method that reaches them. Keys are
 * `<path relative to projectRoot>#<Class.method | function>`.
 *
 * Calls are resolved with the type checker. A call on an abstract class or an
 * interface is followed into every class that extends or implements it, because
 * Nest binds the implementation at runtime.
 */
export function collectAdminMethods(
  roots: string[],
  files: string[],
  compilerOptions: ts.CompilerOptions,
  projectRoot: string,
): Map<string, string> {
  const program = ts.createProgram(files, { ...compilerOptions, noEmit: true, skipLibCheck: true });
  const checker = program.getTypeChecker();
  const inProject = (file: ts.SourceFile) =>
    !file.isDeclarationFile &&
    !file.fileName.includes('/node_modules/') &&
    !relative(projectRoot, file.fileName).startsWith('..') &&
    !isTestFile(file.fileName);
  const keyOf = (fn: Callable): string | undefined => {
    const name = nameOf(fn);
    if (!name) return undefined;
    return `${relative(projectRoot, fn.getSourceFile().fileName).replace(/\\/g, '/')}#${name}`;
  };

  // Base class or interface name → classes that extend or implement it.
  const subclasses = new Map<string, ts.ClassLikeDeclaration[]>();
  const indexHeritage = (node: ts.Node): void => {
    if (ts.isClassLike(node)) {
      for (const clause of node.heritageClauses ?? []) {
        for (const type of clause.types) {
          const base = type.expression.getText();
          subclasses.set(base, [...(subclasses.get(base) ?? []), node]);
        }
      }
    }
    ts.forEachChild(node, indexHeritage);
  };
  for (const file of program.getSourceFiles()) if (inProject(file)) indexHeritage(file);

  const overridesOf = (member: ts.Node): Callable[] => {
    const owner = member.parent;
    const name = (member as { name?: ts.Node }).name?.getText();
    if (!name || !(ts.isClassLike(owner) || ts.isInterfaceDeclaration(owner)) || !owner.name) {
      return [];
    }
    const found: Callable[] = [];
    for (const sub of subclasses.get(owner.name.text) ?? []) {
      for (const candidate of sub.members) {
        if (ts.isMethodDeclaration(candidate) && candidate.name.getText() === name) {
          found.push(candidate);
        }
      }
    }
    return found;
  };

  const callablesOf = (declaration: ts.Declaration): Callable[] => {
    if (ts.isMethodDeclaration(declaration)) return [declaration, ...overridesOf(declaration)];
    if (ts.isMethodSignature(declaration)) return overridesOf(declaration);
    if (isCallable(declaration)) return [declaration];
    if (ts.isVariableDeclaration(declaration) || ts.isPropertyDeclaration(declaration)) {
      const initializer = declaration.initializer;
      return initializer && isCallable(initializer) ? [initializer] : [];
    }
    return [];
  };

  const targetsOf = (call: ts.CallExpression): Callable[] => {
    const callee = ts.isPropertyAccessExpression(call.expression)
      ? call.expression.name
      : call.expression;
    let symbol = checker.getSymbolAtLocation(callee);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);

    return (symbol?.declarations ?? [])
      .filter((declaration) => inProject(declaration.getSourceFile()))
      .flatMap(callablesOf);
  };

  const reached = new Map<string, string>();
  const seen = new Set<Callable>();
  const visit = (fn: Callable, rootKey: string): void => {
    if (seen.has(fn)) return;
    seen.add(fn);
    const body = fn.body;
    if (!body) return;

    const key = keyOf(fn);
    if (key && ADMIN_CONTEXT_RE.test(body.getText()) && !reached.has(key))
      reached.set(key, rootKey);

    const walk = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) for (const target of targetsOf(node)) visit(target, rootKey);
      ts.forEachChild(node, walk);
    };
    walk(body);
  };

  const rootSet = new Set(roots);
  for (const file of program.getSourceFiles()) {
    if (!rootSet.has(file.fileName)) continue;
    const enter = (node: ts.Node): void => {
      if (ts.isMethodDeclaration(node) && ts.isClassLike(node.parent)) {
        const key = keyOf(node);
        if (key) visit(node, key);
        return;
      }
      ts.forEachChild(node, enter);
    };
    enter(file);
  }
  return reached;
}
