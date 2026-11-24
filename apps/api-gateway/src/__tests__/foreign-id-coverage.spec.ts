// Completeness check for tenant isolation tests (ROV-293). Every Query and Mutation that a
// non-platform token can call and that takes an id (an `ID` argument, or an input object with
// an `ID` field at any depth) must be in `FOREIGN_ID_COVERAGE` with the spec that sends it
// another institute's or reseller's id. A new operation without an entry fails here.
//
// The operations come from the generated schema (kept in step with the resolvers by
// `pnpm check:codegen-drift`); the resolver sources only say which file declares each one.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { buildSchema, type GraphQLType, getNamedType, isInputObjectType } from 'graphql';
import { describe, expect, it } from 'vitest';
import { FOREIGN_ID_COVERAGE } from './foreign-id-coverage';

const ROOT = join(__dirname, '../../../..');
const SCHEMA_FILE = join(ROOT, 'libs/frontend/graphql/src/generated/schema.graphql');
const RESOLVER_ROOTS = ['apps/api-gateway/src', 'ee/apps/api-gateway/src'];
/** Resolvers under an `admin/` directory are platform scope: they see every tenant by design. */
const PLATFORM_ONLY_DIR = 'admin';

/** Entries still marked pending. Lower it with every operation covered; never raise it. */
const PENDING_COUNT = 150;

function resolverFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === 'node_modules' || entry === '__tests__' ? [] : resolverFiles(full);
    }
    return entry.endsWith('.resolver.ts') ? [full] : [];
  });
}

const OPERATION_RE =
  /@(?:Query|Mutation)\s*\(([\s\S]*?)\)\s*(?:@[\s\S]*?\)\s*)*?(?:async\s+)?(\w+)\s*\(/g;

/** Operation name → repo-relative resolver file that declares it. */
function declaredOperations(): Map<string, string> {
  const declared = new Map<string, string>();
  for (const root of RESOLVER_ROOTS) {
    for (const file of resolverFiles(join(ROOT, root))) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(OPERATION_RE)) {
        const override = /name:\s*['"](\w+)['"]/.exec(match[1] ?? '');
        const name = override?.[1] ?? match[2];
        if (name) declared.set(name, relative(ROOT, file).split(sep).join('/'));
      }
    }
  }
  return declared;
}

function takesId(type: GraphQLType, seen = new Set<string>()): boolean {
  const named = getNamedType(type);
  if (named.name === 'ID') return true;
  if (!isInputObjectType(named) || seen.has(named.name)) return false;
  seen.add(named.name);
  return Object.values(named.getFields()).some((field) => takesId(field.type, seen));
}

interface Operation {
  name: string;
  file: string | undefined;
}

function schemaOperations(): { all: Operation[]; idTaking: Operation[] } {
  const schema = buildSchema(readFileSync(SCHEMA_FILE, 'utf8'));
  const declared = declaredOperations();
  const all: Operation[] = [];
  const idTaking: Operation[] = [];
  for (const root of [schema.getQueryType(), schema.getMutationType()]) {
    for (const field of Object.values(root?.getFields() ?? {})) {
      const operation = { name: field.name, file: declared.get(field.name) };
      all.push(operation);
      const platformOnly = operation.file?.split('/').includes(PLATFORM_ONLY_DIR) ?? false;
      if (!platformOnly && field.args.some((arg) => takesId(arg.type))) idTaking.push(operation);
    }
  }
  return { all, idTaking };
}

describe('foreign-id test coverage of institute and reseller operations', () => {
  const { all, idTaking } = schemaOperations();
  const required = new Set(idTaking.map((o) => o.name));

  it('should find the resolver file of every operation in the schema', () => {
    expect(all.filter((o) => o.file === undefined).map((o) => o.name)).toEqual([]);
  });

  it('should have a registry entry for every non-platform operation that takes an id', () => {
    const missing = idTaking
      .filter((o) => !(o.name in FOREIGN_ID_COVERAGE))
      .map((o) => `${o.name} (${o.file})`);
    expect(missing).toEqual([]);
  });

  it('should have no registry entry for an operation that is gone or takes no id', () => {
    expect(Object.keys(FOREIGN_ID_COVERAGE).filter((name) => !required.has(name))).toEqual([]);
  });

  it('should point every covered operation at an existing spec that names it', () => {
    const broken: string[] = [];
    for (const [name, coverage] of Object.entries(FOREIGN_ID_COVERAGE)) {
      if (!('spec' in coverage)) continue;
      const file = join(ROOT, coverage.spec);
      if (!existsSync(file)) broken.push(`${name}: ${coverage.spec} does not exist`);
      else if (!new RegExp(`\\b${name}\\b`).test(readFileSync(file, 'utf8'))) {
        broken.push(`${name}: ${coverage.spec} never names the operation`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('should give a reason for every exempt operation', () => {
    const unexplained = Object.entries(FOREIGN_ID_COVERAGE)
      .filter(([, coverage]) => 'exempt' in coverage && coverage.exempt.trim().length < 20)
      .map(([name]) => name);
    expect(unexplained).toEqual([]);
  });

  it('should not let the number of pending operations grow', () => {
    const pending = Object.values(FOREIGN_ID_COVERAGE).filter((c) => 'pending' in c).length;
    expect(pending).toBe(PENDING_COUNT);
  });
});
