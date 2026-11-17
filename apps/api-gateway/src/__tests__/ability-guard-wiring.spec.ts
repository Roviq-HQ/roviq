// `@CheckAbility` only sets metadata. Without `AbilityGuard` on the class or the
// handler nothing reads it and the endpoint is open to every caller of the scope.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '../../../..');
const SOURCES = [join(__dirname, '..'), join(REPO_ROOT, 'ee/apps/api-gateway/src')];

function resolverFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules' && entry !== '__tests__') out.push(...resolverFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Start of the decorator lines that sit directly above the class at `classIndex`. */
function decoratorStart(source: string, classIndex: number): number {
  const before = source.slice(0, classIndex);
  const boundary = Math.max(
    before.lastIndexOf(';\n'),
    before.lastIndexOf('}\n'),
    before.lastIndexOf('*/\n'),
  );
  return boundary === -1 ? 0 : boundary + 2;
}

/** Handlers that carry `@CheckAbility` with no `AbilityGuard` on them or on their class. */
function unguardedHandlers(source: string): string[] {
  const unguarded: string[] = [];
  const classIndexes = [...source.matchAll(/^export class /gm)].map((match) => match.index);
  classIndexes.forEach((classIndex, position) => {
    const next = classIndexes[position + 1];
    const end = next === undefined ? source.length : decoratorStart(source, next);
    const classGuarded = source
      .slice(decoratorStart(source, classIndex), classIndex)
      .includes('AbilityGuard');
    const handlers = source
      .slice(classIndex, end)
      .split(/\n {2}(?=@(?:Query|Mutation|Subscription|ResolveField)\()/);
    for (const handler of handlers.slice(1)) {
      const name = /\n {2}(?:async\s+)?(\w+)\s*\(/.exec(handler);
      const decorators = name ? handler.slice(0, name.index) : handler;
      if (!decorators.includes('@CheckAbility(')) continue;
      if (!classGuarded && !decorators.includes('AbilityGuard')) {
        unguarded.push(name?.[1] ?? '<unknown>');
      }
    }
  });
  return unguarded;
}

/**
 * Class-level `@UseGuards(...)` calls where AbilityGuard would run before the
 * request is authenticated. Handler-level guards run after the class-level ones,
 * so a lone `@UseGuards(AbilityGuard)` on a handler is fine.
 */
function misorderedClassGuards(source: string): string[] {
  return [...source.matchAll(/^export class /gm)].flatMap((match) =>
    [
      ...source
        .slice(decoratorStart(source, match.index), match.index)
        .matchAll(/@UseGuards\(([^)]*)\)/g),
    ]
      .map((guards) => guards[1].split(',').map((guard) => guard.trim()))
      .filter((guards) => guards.includes('AbilityGuard'))
      .filter((guards) => {
        const auth = guards.indexOf('GqlAuthGuard');
        return auth === -1 || auth > guards.indexOf('AbilityGuard');
      })
      .map((guards) => guards.join(', ')),
  );
}

describe('AbilityGuard wiring', () => {
  it('should flag a handler whose class and decorators lack AbilityGuard', () => {
    const source = [
      '@PlatformScope()',
      '@Resolver()',
      'export class OpenResolver {',
      '  @Query(() => Boolean)',
      "  @CheckAbility({ action: 'read', subject: 'Reseller' })",
      '  async open() {',
      '    return true;',
      '  }',
      '}',
    ].join('\n');

    expect(unguardedHandlers(source)).toEqual(['open']);
  });

  it('should accept AbilityGuard on the class or on the handler', () => {
    const source = [
      '@PlatformScope()',
      '@UseGuards(AbilityGuard)',
      '@Resolver()',
      'export class ClassGuarded {',
      '  @Query(() => Boolean)',
      "  @CheckAbility({ action: 'read', subject: 'Reseller' })",
      '  async a() {',
      '    return true;',
      '  }',
      '}',
      '',
      '@Resolver()',
      'export class HandlerGuarded {',
      '  @Query(() => Boolean)',
      '  @UseGuards(GqlAuthGuard, PlatformScopeGuard, AbilityGuard)',
      "  @CheckAbility({ action: 'read', subject: 'Reseller' })",
      '  async b() {',
      '    return true;',
      '  }',
      '}',
    ].join('\n');

    expect(unguardedHandlers(source)).toEqual([]);
  });

  it('should have AbilityGuard on every resolver handler that uses @CheckAbility', () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const file of SOURCES.flatMap(resolverFiles)) {
      const source = readFileSync(file, 'utf8');
      if (!source.includes('@CheckAbility(')) continue;
      checked += 1;
      for (const handler of unguardedHandlers(source)) {
        offenders.push(`${relative(REPO_ROOT, file)} → ${handler}`);
      }
    }

    expect(checked).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });
  it('should flag a class-level AbilityGuard registered apart from, or ahead of, GqlAuthGuard', () => {
    // Decorators apply bottom-up: a separate `@UseGuards(AbilityGuard)` under a
    // scope decorator runs first and finds no authenticated user.
    const separate = [
      '@InstituteScope()',
      '@UseGuards(AbilityGuard)',
      '@Resolver()',
      'export class Separate {}',
    ].join('\n');
    const reversed = ['@UseGuards(AbilityGuard, GqlAuthGuard)', 'export class Reversed {}'].join(
      '\n',
    );
    const ordered = [
      '@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)',
      '@Resolver()',
      'export class Ordered {',
      '  @Query(() => Boolean)',
      '  @UseGuards(AbilityGuard)',
      '  async handler() {',
      '    return true;',
      '  }',
      '}',
    ].join('\n');

    expect(misorderedClassGuards(separate)).toEqual(['AbilityGuard']);
    expect(misorderedClassGuards(reversed)).toEqual(['AbilityGuard, GqlAuthGuard']);
    expect(misorderedClassGuards(ordered)).toEqual([]);
  });

  it('should run AbilityGuard after GqlAuthGuard in every class-level guard chain', () => {
    const offenders: string[] = [];
    for (const file of SOURCES.flatMap(resolverFiles)) {
      for (const chain of misorderedClassGuards(readFileSync(file, 'utf8'))) {
        offenders.push(`${relative(REPO_ROOT, file)} → @UseGuards(${chain})`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
