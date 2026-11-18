import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectAdminMethods } from '../lib/admin-method-reach';

describe('collectAdminMethods', () => {
  let root: string;
  const files: string[] = [];

  const write = (rel: string, text: string): string => {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
    files.push(full);
    return full;
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'admin-method-reach-'));
    files.length = 0;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const REPO = `
    declare function withAdmin<T>(fn: () => T): T;
    declare function withTenant<T>(fn: () => T): T;
    export abstract class Repo {
      abstract findOwn(id: string): string;
      abstract findAny(id: string): string;
      abstract adminOnly(id: string): string;
    }
    export class DrizzleRepo extends Repo {
      findOwn(id: string) { return withTenant(() => id); }
      findAny(id: string) { return withAdmin(() => id); }
      adminOnly(id: string) { return withAdmin(() => id); }
    }
  `;

  it('reports only the admin-context methods a resolver can reach, through an abstract repository', () => {
    write('repo.ts', REPO);
    write(
      'service.ts',
      `import { Repo } from './repo';
       export class Service {
         constructor(private readonly repo: Repo) {}
         read(id: string) { return this.repo.findOwn(id); }
         readAny(id: string) { return this.repo.findAny(id); }
       }`,
    );
    const resolver = write(
      'a.resolver.ts',
      `import { Service } from './service';
       export class AResolver {
         constructor(private readonly service: Service) {}
         one(id: string) { return this.service.read(id); }
         two(id: string) { return this.service.readAny(id); }
       }`,
    );

    const reached = collectAdminMethods([resolver], files, {}, root);

    expect([...reached]).toEqual([['repo.ts#DrizzleRepo.findAny', 'a.resolver.ts#AResolver.two']]);
  });

  it('follows plain functions and reports the one that opens the admin context', () => {
    write(
      'helpers.ts',
      `declare function withAdmin<T>(fn: () => T): T;
       export function lookup(id: string) { return withAdmin(() => id); }
       export const unused = (id: string) => withAdmin(() => id);`,
    );
    const resolver = write(
      'b.resolver.ts',
      `import { lookup } from './helpers';
       export class BResolver { get(id: string) { return lookup(id); } }`,
    );

    const reached = collectAdminMethods([resolver], files, {}, root);

    expect([...reached]).toEqual([['helpers.ts#lookup', 'b.resolver.ts#BResolver.get']]);
  });

  it('reports a resolver method that opens the admin context itself and survives recursion', () => {
    const resolver = write(
      'c.resolver.ts',
      `declare function mkAdminCtx(name: string): string;
       export class CResolver {
         direct() { return mkAdminCtx('c'); }
         loop(n: number): number { return n > 0 ? this.loop(n - 1) : 0; }
       }`,
    );

    const reached = collectAdminMethods([resolver], files, {}, root);

    expect([...reached]).toEqual([
      ['c.resolver.ts#CResolver.direct', 'c.resolver.ts#CResolver.direct'],
    ]);
  });
});
