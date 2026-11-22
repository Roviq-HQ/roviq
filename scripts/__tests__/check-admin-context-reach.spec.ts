import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  collectImplementations,
  collectReach,
  findViolations,
  usesAdminContext,
} from '../check-admin-context-reach';

describe('usesAdminContext', () => {
  it('detects mkAdminCtx and withAdmin calls', () => {
    expect(usesAdminContext("withAdmin(db, mkAdminCtx('x'), fn)")).toBe(true);
    expect(usesAdminContext('return withAdmin(this.db, ctx, fn);')).toBe(true);
  });

  it('ignores tenant and reseller wrappers', () => {
    expect(usesAdminContext("withTenant(db, mkInstituteCtx(id, 'x'), fn)")).toBe(false);
    expect(usesAdminContext("withReseller(db, mkResellerCtx(id, 'x'), fn)")).toBe(false);
  });
});

describe('collectReach + findViolations', () => {
  let root: string;

  const write = (rel: string, text: string): string => {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
    return full;
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'admin-reach-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reports an admin-context file reached through a service', () => {
    const resolver = write('institute/a.resolver.ts', "import { S } from './a.service';\nS;");
    write('institute/a.service.ts', "import { R } from '../repo/a.repo';\nexport const S = R;");
    write('repo/a.repo.ts', "export const R = () => withAdmin(db, mkAdminCtx('r'), fn);");

    const reach = collectReach([resolver], {}, root);
    const result = findViolations(reach, {}, root);

    expect(result).toEqual({
      unlisted: [{ file: 'repo/a.repo.ts', root: 'institute/a.resolver.ts' }],
      stale: [],
    });
  });

  it('accepts a reached admin-context file that is listed with a reason', () => {
    const resolver = write('institute/a.resolver.ts', "import { R } from './a.repo';\nR;");
    write('institute/a.repo.ts', "export const R = () => withAdmin(db, mkAdminCtx('r'), fn);");

    const reach = collectReach([resolver], {}, root);

    expect(
      findViolations(reach, { 'institute/a.repo.ts': 'id comes from the token' }, root),
    ).toEqual({
      unlisted: [],
      stale: [],
    });
  });

  it('reports an allowlist entry that no root reaches any more', () => {
    const resolver = write('institute/a.resolver.ts', 'export const x = 1;');

    const reach = collectReach([resolver], {}, root);

    expect(findViolations(reach, { 'gone/old.repo.ts': 'was needed once' }, root)).toEqual({
      unlisted: [],
      stale: ['gone/old.repo.ts'],
    });
  });

  it('does not follow imports into test files', () => {
    const resolver = write(
      'institute/a.resolver.ts',
      "import { F } from './__tests__/fixture';\nimport { G } from './b.spec';\nF; G;",
    );
    write('institute/__tests__/fixture.ts', "export const F = () => mkAdminCtx('t');");
    write('institute/b.spec.ts', "export const G = () => mkAdminCtx('t');");

    const reach = collectReach([resolver], {}, root);

    expect(findViolations(reach, {}, root)).toEqual({ unlisted: [], stale: [] });
  });

  it('follows an abstract repository to the class that implements it', () => {
    const resolver = write(
      'institute/a.resolver.ts',
      "import { Repo } from './a.repository';\nRepo;",
    );
    const base = write('institute/a.repository.ts', 'export abstract class Repo {}');
    const impl = write(
      'institute/a.drizzle-repository.ts',
      "import { Repo } from './a.repository';\nexport class DrizzleRepo extends Repo {\n  find() { return withAdmin(db, mkAdminCtx('r'), fn); }\n}",
    );

    const implementations = collectImplementations([resolver, base, impl], {});
    const reach = collectReach([resolver], {}, root, implementations);

    expect(findViolations(reach, {}, root)).toEqual({
      unlisted: [{ file: 'institute/a.drizzle-repository.ts', root: 'institute/a.resolver.ts' }],
      stale: [],
    });
  });

  it('ties a subclass to the file that declares its base, not to the barrel it came through', () => {
    const resolver = write(
      'institute/a.resolver.ts',
      "import { Client } from '../lib/index';\nClient;",
    );
    const barrel = write(
      'lib/index.ts',
      "export { Client } from './client';\nexport { BaseWorker } from './base-worker';",
    );
    const client = write('lib/client.ts', 'export class Client {}');
    const baseWorker = write('lib/base-worker.ts', 'export abstract class BaseWorker {}');
    const worker = write(
      'jobs/a.worker.ts',
      "import { BaseWorker } from '../lib/index';\nimport { run } from './a.activities';\nexport class AWorker extends BaseWorker { go() { return run; } }",
    );
    const activities = write(
      'jobs/a.activities.ts',
      "export const run = () => withAdmin(db, mkAdminCtx('a'), fn);",
    );

    const implementations = collectImplementations(
      [resolver, barrel, client, baseWorker, worker, activities],
      {},
    );
    const reach = collectReach([resolver], {}, root, implementations);

    expect([...implementations.entries()]).toEqual([[baseWorker, [worker]]]);
    expect(findViolations(reach, {}, root)).toEqual({ unlisted: [], stale: [] });
  });

  it('follows a dynamic import of a barrel to everything the barrel exports', () => {
    const resolver = write(
      'institute/a.resolver.ts',
      "import { Client } from '../lib/index';\nexport const load = () => import('../lib/index');\nClient;",
    );
    const barrel = write(
      'lib/index.ts',
      "export { Client } from './client';\nexport { BaseWorker } from './base-worker';",
    );
    const client = write('lib/client.ts', 'export class Client {}');
    const baseWorker = write('lib/base-worker.ts', 'export abstract class BaseWorker {}');

    const reach = collectReach([resolver], {}, root, new Map());

    expect([...reach.keys()].sort()).toEqual(
      [resolver, barrel, client, baseWorker].map((file) => relative(root, file)).sort(),
    );
  });

  it('terminates on an import cycle', () => {
    const resolver = write(
      'institute/a.resolver.ts',
      "import { B } from './b';\nexport const A = B;",
    );
    write('institute/b.ts', "import { A } from './a.resolver';\nexport const B = () => A;");

    const reach = collectReach([resolver], {}, root);

    expect([...reach.keys()].sort()).toEqual(['institute/a.resolver.ts', 'institute/b.ts']);
  });
});
