// CI guard — lists every file that runs queries as the admin DB role
// (`withAdmin` / `mkAdminCtx`, RLS bypassed) and is reachable from a resolver
// that a non-platform token can call (every resolver outside `admin/`).
//
// Why: ROV-290. Institute-scope resolvers reached repositories that ran as
// admin with caller-supplied ids, so any institute login could read and change
// other tenants' rows. `check:synthetic-context-usage` allowlists files, but
// not who reaches them; this gate tracks the reach.
//
// Limit: the check is per file, not per method. It flags a new edge and forces
// a written reason, but the reason is what a reviewer must verify.

import { type Dirent, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();

/** Every resolver outside an `admin/` directory can be called with a non-platform token. */
const RESOLVER_ROOT_DIRS = ['apps/api-gateway/src', 'ee/apps/api-gateway/src'];
const PLATFORM_ONLY_DIR = 'admin';

// Reached admin-context file → why no caller-chosen id reaches an admin query in it.
export const ADMIN_REACH_ALLOWLIST: Readonly<Record<string, string>> = {
  'apps/api-gateway/src/audit/repositories/audit-query.drizzle-repository.ts':
    'Admin role only when the caller passes neither tenant nor reseller id; institute and reseller resolvers always pass their own from the token.',
  'apps/api-gateway/src/auth/auth-event.service.ts':
    'Insert-only writer of auth events; reads nothing back.',
  'apps/api-gateway/src/auth/identity.service.ts':
    'Creates users on platform-level tables; tenant and reseller ids come from the caller token, never from arguments.',
  'apps/api-gateway/src/auth/impersonation.service.ts':
    'Every lookup is checked against the actor scope, tenant, reseller and role rank before a session is issued (ROV-94).',
  'apps/api-gateway/src/auth/repositories/membership.drizzle-repository.ts':
    'Login and token flows: memberships are looked up for the authenticated user id; a membership id from the client is matched against that user before use (ROV-92).',
  'apps/api-gateway/src/auth/repositories/platform-membership.drizzle-repository.ts':
    'Looked up by the authenticated user id during login and refresh.',
  'apps/api-gateway/src/auth/repositories/refresh-token.drizzle-repository.ts':
    'Tokens are found by their own hash or id and checked against the calling user before revocation (ROV-92).',
  'apps/api-gateway/src/auth/repositories/reseller-membership.drizzle-repository.ts':
    'Looked up by the authenticated user id during login and refresh.',
  'apps/api-gateway/src/auth/repositories/user.drizzle-repository.ts':
    'Users are a platform-level table; lookups use the login identifier or the token user id.',
  'apps/api-gateway/src/passkey/repositories/auth-provider.drizzle-repository.ts':
    'Passkeys are read and deleted by the token user id; login lookups use the credential id presented by the authenticator.',
  'apps/api-gateway/src/institute/academic-year/academic-year.service.ts':
    'Reads the type of the institute named by the token tenant id.',
  'apps/api-gateway/src/institute/bot/bot.service.ts':
    'Writes platform-level user rows for a bot created in the token tenant; the membership id comes from a tenant-scoped lookup.',
  'apps/api-gateway/src/institute/certificate/certificate.service.ts':
    'Reads user_profiles for a user id taken from a tenant-scoped student lookup.',
  'apps/api-gateway/src/institute/group/group.service.ts':
    'Reads usernames for user ids taken from tenant-scoped membership rows.',
  'apps/api-gateway/src/institute/guardian/guardian.service.ts':
    'Writes platform-level user tables for a user id taken from a tenant-scoped guardian row.',
  'apps/api-gateway/src/institute/institute-group/repositories/institute-group.drizzle-repository.ts':
    'Institute scope reaches only findForTenant (tenant RLS) and findMembershipsByUser(token user id); reseller scope reaches the *ForReseller methods (reseller RLS) and create with its own reseller id. The admin-context methods are called from the admin resolver only.',
  'apps/api-gateway/src/institute/management/repositories/institute.drizzle-repository.ts':
    'Institute scope passes only the token tenant id. Reseller scope uses the *ByReseller methods, checks ownership through findByReseller before a status change, and creates with its own reseller id and a group it owns (assertOwnedByReseller).',
  'apps/api-gateway/src/institute/management/seed/institute-setup.service.ts':
    'Runs from institute activation, which only admin and reseller resolvers can trigger after their own ownership checks.',
  'apps/api-gateway/src/institute/staff/staff.service.ts':
    'Writes platform-level user tables for the user it just created in the token tenant.',
  'apps/api-gateway/src/institute/student/student.service.ts':
    'Touches platform-level user tables for a user id taken from a tenant-scoped student row. KNOWN GAP (ROV-292): create reuses an existing user matched by phone number without consent, and later updates write that shared profile.',
  'apps/api-gateway/src/institute/user/profile.service.ts':
    'Reads and writes the profile of the token user id only.',
  'apps/api-gateway/src/reseller/team/reseller-team.service.ts':
    'Role lookup is filtered by the token reseller id.',
  'ee/apps/api-gateway/src/billing/repositories/subscription.repository.ts':
    'Counts subscribers for plan ids already returned to the caller by a reseller-scoped query.',
  'ee/libs/backend/payments/src/repositories/payment-gateway-config.drizzle-repository.ts':
    'Looked up by the token reseller id or by an invoice the caller was already shown.',
  'libs/backend/casl/src/repositories/membership-ability.drizzle-repository.ts':
    'Loads abilities for the membership id and tenant id in the verified token.',
  'libs/backend/casl/src/repositories/role.drizzle-repository.ts':
    'Loads abilities for the role id in the verified token.',
  'libs/backend/casl/src/seed-roles.ts':
    'Seeds default roles for a tenant id chosen by institute creation, not by a request argument.',
  'libs/database/src/tenant-db.ts': 'Defines the wrappers themselves.',
};

const ADMIN_CONTEXT_RE = /\b(mkAdminCtx|withAdmin)\(/;

export function usesAdminContext(source: string): boolean {
  return ADMIN_CONTEXT_RE.test(source);
}

function isTestFile(path: string): boolean {
  return path.includes('/__tests__/') || /\.spec\.tsx?$/.test(path);
}

function toRel(projectRoot: string, file: string): string {
  return relative(projectRoot, file).replace(/\\/g, '/');
}

function resolveImport(
  specifier: string,
  from: string,
  compilerOptions: ts.CompilerOptions,
): string | undefined {
  const resolved = ts.resolveModuleName(specifier, from, compilerOptions, ts.sys).resolvedModule
    ?.resolvedFileName;
  if (!resolved || resolved.includes('/node_modules/') || resolved.endsWith('.d.ts')) return;
  return resolved;
}

/**
 * Nest binds an abstract repository to its implementation in a module, so the
 * service never imports the implementation. Maps each file that declares a base
 * class to the files whose classes extend it.
 */
export function collectImplementations(
  files: string[],
  compilerOptions: ts.CompilerOptions,
): Map<string, string[]> {
  const implementations = new Map<string, string[]>();
  for (const file of files) {
    if (isTestFile(file)) continue;
    const source = ts.sys.readFile(file);
    if (source === undefined) continue;
    const bases = new Set([...source.matchAll(/\bextends\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
    if (bases.size === 0) continue;

    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false);
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
        continue;
      }
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      if (!bindings.elements.some((element) => bases.has(element.name.text))) continue;

      const baseFile = resolveImport(statement.moduleSpecifier.text, file, compilerOptions);
      if (!baseFile) continue;
      implementations.set(baseFile, [...(implementations.get(baseFile) ?? []), file]);
    }
  }
  return implementations;
}

/**
 * Every source file transitively imported from `roots`, mapped to the first
 * root that reaches it. Keys and values are paths relative to `projectRoot`.
 */
export function collectReach(
  roots: string[],
  compilerOptions: ts.CompilerOptions,
  projectRoot: string = ROOT,
  implementations: Map<string, string[]> = new Map(),
): Map<string, string> {
  const reach = new Map<string, string>();
  for (const root of roots) {
    const rootRel = toRel(projectRoot, root);
    const queue = [root];
    for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
      const rel = toRel(projectRoot, file);
      if (reach.has(rel)) continue;
      reach.set(rel, rootRel);
      queue.push(...neighbours(file, compilerOptions, projectRoot, implementations));
    }
  }
  return reach;
}

function neighbours(
  file: string,
  compilerOptions: ts.CompilerOptions,
  projectRoot: string,
  implementations: Map<string, string[]>,
): string[] {
  const source = ts.sys.readFile(file);
  if (source === undefined) return [];

  const next = [...(implementations.get(file) ?? [])];
  for (const imported of ts.preProcessFile(source, true, true).importedFiles) {
    const resolved = resolveImport(imported.fileName, file, compilerOptions);
    if (resolved) next.push(resolved);
  }
  return next.filter(
    (candidate) => !toRel(projectRoot, candidate).startsWith('..') && !isTestFile(candidate),
  );
}

export function findViolations(
  reach: Map<string, string>,
  allowlist: Readonly<Record<string, string>>,
  projectRoot: string = ROOT,
): { unlisted: { file: string; root: string }[]; stale: string[] } {
  const adminFiles = new Map<string, string>();
  for (const [file, root] of reach) {
    const source = ts.sys.readFile(join(projectRoot, file));
    if (source !== undefined && usesAdminContext(source)) adminFiles.set(file, root);
  }

  const unlisted = [...adminFiles]
    .filter(([file]) => !(file in allowlist))
    .map(([file, root]) => ({ file, root }))
    .sort((a, b) => a.file.localeCompare(b.file));
  const stale = Object.keys(allowlist)
    .filter((file) => !adminFiles.has(file))
    .sort();
  return { unlisted, stale };
}

function findSources(dir: string, out: string[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) findSources(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
}

function findResolvers(dir: string, out: string[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const skip = ['__tests__', 'node_modules', PLATFORM_ONLY_DIR].includes(entry.name);
      if (!skip) findResolvers(full, out);
    } else if (/\.(resolver|subscription)\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
}

function loadCompilerOptions(): ts.CompilerOptions {
  const configPath = join(ROOT, 'tsconfig.base.json');
  const config = ts.parseConfigFileTextToJson(configPath, readFileSync(configPath, 'utf8'));
  return ts.convertCompilerOptionsFromJson(config.config?.compilerOptions ?? {}, ROOT).options;
}

function main(): number {
  const roots: string[] = [];
  for (const dir of RESOLVER_ROOT_DIRS) findResolvers(join(ROOT, dir), roots);

  const compilerOptions = loadCompilerOptions();
  const sources: string[] = [];
  for (const dir of ['apps/api-gateway/src', 'ee', 'libs']) findSources(join(ROOT, dir), sources);

  const reach = collectReach(
    roots,
    compilerOptions,
    ROOT,
    collectImplementations(sources, compilerOptions),
  );
  const { unlisted, stale } = findViolations(reach, ADMIN_REACH_ALLOWLIST);

  if (unlisted.length === 0 && stale.length === 0) {
    process.stdout.write(
      `check:admin-context-reach — ${Object.keys(ADMIN_REACH_ALLOWLIST).length} admin-context file(s) reachable from non-platform resolvers, all listed with a reason.\n`,
    );
    return 0;
  }

  if (unlisted.length > 0) {
    process.stderr.write(
      `check:admin-context-reach — ${unlisted.length} admin-context file(s) newly reachable from an institute or reseller resolver:\n\n`,
    );
    for (const hit of unlisted)
      process.stderr.write(`  ${hit.file}\n    reached from ${hit.root}\n`);
    process.stderr.write(
      '\nThese files run queries as roviq_admin (RLS bypassed). Check every admin-context method the resolver can reach:\n' +
        'an id that the caller supplies must be verified against the caller’s tenant or reseller first, or the query must\n' +
        'move to withTenant / withReseller. Then add the file to ADMIN_REACH_ALLOWLIST with the reason.\n',
    );
  }
  if (stale.length > 0) {
    process.stderr.write(
      `\ncheck:admin-context-reach — ${stale.length} allowlist entr${stale.length === 1 ? 'y is' : 'ies are'} no longer reached; remove:\n\n`,
    );
    for (const file of stale) process.stderr.write(`  ${file}\n`);
  }
  return 1;
}

if (process.argv[1]?.endsWith('check-admin-context-reach.ts')) {
  process.exit(main());
}
