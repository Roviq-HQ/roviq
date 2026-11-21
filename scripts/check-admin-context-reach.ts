// CI guard — finds every function that runs queries as the admin DB role
// (`withAdmin` / `mkAdminCtx`, RLS bypassed) and can be called, directly or
// through services and repositories, from a resolver outside `admin/`.
//
// Why: ROV-290. Institute- and reseller-scope resolvers reached repositories
// that ran as admin with caller-supplied ids, so one tenant could read and
// change another's rows.
//
// Limit: static analysis. It flags a new reachable admin-context function when
// the type checker can resolve the calls to it; calls it cannot resolve
// (dataloaders, event handlers) fall back to the file list. It does not prove a
// listed function is safe: the proof for an operation is a test that sends
// another tenant's id and asserts refusal.

import { type Dirent, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { collectAdminMethods } from './lib/admin-method-reach';

const ROOT = process.cwd();

/** Every resolver outside an `admin/` directory can be called with a non-platform token. */
const RESOLVER_ROOT_DIRS = ['apps/api-gateway/src', 'ee/apps/api-gateway/src'];
const PLATFORM_ONLY_DIR = 'admin';

// Admin-context function reachable from a non-admin resolver → why a caller cannot aim it at
// another tenant's or reseller's rows. One entry per function: a new one fails CI.
// These are reviewed claims, not proofs — re-check the function when you touch it.
export const ADMIN_METHOD_ALLOWLIST: Readonly<Record<string, string>> = {
  'apps/api-gateway/src/institute/certificate/repositories/tc-verification.repository.ts#TcVerificationRepository.findByToken':
    'Public TC check by the 32-character random token from the printed QR code; runs only the verify_tc() function, which returns the six fields of the verification page.',
  'apps/api-gateway/src/audit/repositories/audit-query.drizzle-repository.ts#AuditQueryDrizzleRepository.findAuditLogs':
    'Admin role only when the caller passes neither tenant nor reseller id; institute and reseller resolvers always pass their own from the token.',
  'apps/api-gateway/src/audit/repositories/audit-query.drizzle-repository.ts#runInContext':
    'Admin role only when the caller passes neither tenant nor reseller id; institute and reseller resolvers always pass their own from the token.',
  'apps/api-gateway/src/auth/auth-event.service.ts#AuthEventService.emit':
    'Insert-only writer of auth events; reads nothing back.',
  'apps/api-gateway/src/auth/identity.service.ts#IdentityService.createMembership':
    'Tenant or reseller id comes from the caller token; the reseller invite verifies the role belongs to that reseller first.',
  'apps/api-gateway/src/auth/identity.service.ts#IdentityService.createUser':
    'Creates a new platform-level user; no existing row is read or changed.',
  'apps/api-gateway/src/auth/identity.service.ts#IdentityService.ensureUserProfile':
    'Called only for a user the same request just created; never with a caller-supplied id.',
  'apps/api-gateway/src/auth/identity.service.ts#IdentityService.findUserContact':
    'The user id is the institute row’s first_admin_user_id, read only after the platform or owning-reseller check; a reseller gets the name and phone only when wasCreatedByReseller is true.',
  'apps/api-gateway/src/auth/identity.service.ts#IdentityService.wasCreatedByReseller':
    'Boolean only; the user id is the institute row’s first_admin_user_id and the reseller id comes from the caller token, both after the owning-reseller check.',
  'apps/api-gateway/src/auth/identity.service.ts#IdentityService.findUsersByEmail':
    'Email lookup for linking a membership; returns only user id and deleted flag, and the reseller invite answers every unusable address with one error code.',
  'apps/api-gateway/src/auth/identity.service.ts#IdentityService.isPhoneTaken':
    'Boolean existence check for a number the caller typed for a new account; refusing a taken number is what keeps the welcome from going to another person’s phone.',
  'apps/api-gateway/src/auth/identity.service.ts#IdentityService.isUsernameTaken':
    'Boolean existence check; the reseller invite answers every unusable address with one error code.',
  'apps/api-gateway/src/auth/impersonation.service.ts#ImpersonationService.assertActiveResellerMembership':
    'Impersonation (ROV-94): every target is checked against the actor scope, tenant, reseller and role rank before a session is issued; sessions are listed and ended only for the actor.',
  'apps/api-gateway/src/auth/impersonation.service.ts#ImpersonationService.assertStillAuthorized':
    'Impersonation (ROV-94): every target is checked against the actor scope, tenant, reseller and role rank before a session is issued; sessions are listed and ended only for the actor.',
  'apps/api-gateway/src/auth/impersonation.service.ts#ImpersonationService.createSession':
    'Impersonation (ROV-94): every target is checked against the actor scope, tenant, reseller and role rank before a session is issued; sessions are listed and ended only for the actor.',
  'apps/api-gateway/src/auth/impersonation.service.ts#ImpersonationService.dispatchImpersonationOtp':
    'Impersonation (ROV-94): every target is checked against the actor scope, tenant, reseller and role rank before a session is issued; sessions are listed and ended only for the actor.',
  'apps/api-gateway/src/auth/impersonation.service.ts#ImpersonationService.endImpersonation':
    'Impersonation (ROV-94): every target is checked against the actor scope, tenant, reseller and role rank before a session is issued; sessions are listed and ended only for the actor.',
  'apps/api-gateway/src/auth/impersonation.service.ts#ImpersonationService.exchangeCode':
    'Impersonation (ROV-94): every target is checked against the actor scope, tenant, reseller and role rank before a session is issued; sessions are listed and ended only for the actor.',
  'apps/api-gateway/src/auth/impersonation.service.ts#ImpersonationService.listSessions':
    'Impersonation (ROV-94): every target is checked against the actor scope, tenant, reseller and role rank before a session is issued; sessions are listed and ended only for the actor.',
  'apps/api-gateway/src/auth/impersonation.service.ts#ImpersonationService.resolveEndReason':
    'Impersonation (ROV-94): every target is checked against the actor scope, tenant, reseller and role rank before a session is issued; sessions are listed and ended only for the actor.',
  'apps/api-gateway/src/auth/impersonation.service.ts#ImpersonationService.startImpersonation':
    'Impersonation (ROV-94): every target is checked against the actor scope, tenant, reseller and role rank before a session is issued; sessions are listed and ended only for the actor.',
  'apps/api-gateway/src/auth/impersonation.service.ts#ImpersonationService.canImpersonateInInstitute':
    'View-as check (ROV-183): reads only roles the target holds in the caller token tenant and returns a boolean.',
  'apps/api-gateway/src/auth/impersonation.service.ts#ImpersonationService.intraInstituteRefusal':
    'Impersonation (ROV-94): every target is checked against the actor scope, tenant, reseller and role rank before a session is issued; sessions are listed and ended only for the actor.',
  'apps/api-gateway/src/auth/impersonation.service.ts#ImpersonationService.isPlatformFullAdmin':
    'Code exchange (ROV-183): the user comes from the session row, never from the caller; decides only whether the token is view-only.',
  'apps/api-gateway/src/auth/impersonation.service.ts#ImpersonationService.isResellerFullAdmin':
    'Code exchange (ROV-183): user and reseller come from the session row and its institute, never from the caller; decides only whether the token is view-only.',
  'apps/api-gateway/src/auth/repositories/membership.drizzle-repository.ts#MembershipDrizzleRepository.findActiveByUserId':
    'Login and token flow: looked up by the presented credential or by ids inside the verified token; nothing is returned before the credential check passes.',
  'apps/api-gateway/src/auth/repositories/membership.drizzle-repository.ts#MembershipDrizzleRepository.hasMembershipInUnusableInstitute':
    'Login runs before any tenant is chosen; the user id comes from the verified credentials, never from input.',
  'apps/api-gateway/src/auth/repositories/membership.drizzle-repository.ts#MembershipDrizzleRepository.findByIdAndUser':
    'A membership id from the client is matched against the authenticated user id in the same query.',
  'apps/api-gateway/src/auth/repositories/platform-membership.drizzle-repository.ts#PlatformMembershipDrizzleRepository.findByUserId':
    'Login and token flow: looked up by the presented credential or by ids inside the verified token; nothing is returned before the credential check passes.',
  'apps/api-gateway/src/auth/repositories/refresh-token.drizzle-repository.ts#RefreshTokenDrizzleRepository.create':
    'Tokens are found by their own hash or by the id inside the verified refresh JWT, and checked against the calling user before revocation (ROV-92).',
  'apps/api-gateway/src/auth/repositories/refresh-token.drizzle-repository.ts#RefreshTokenDrizzleRepository.findActiveByUserId':
    'Keyed by the user id in the verified token.',
  'apps/api-gateway/src/auth/repositories/refresh-token.drizzle-repository.ts#RefreshTokenDrizzleRepository.findByHash':
    'Tokens are found by their own hash or by the id inside the verified refresh JWT, and checked against the calling user before revocation (ROV-92).',
  'apps/api-gateway/src/auth/repositories/refresh-token.drizzle-repository.ts#RefreshTokenDrizzleRepository.findByIdWithRelations':
    'Tokens are found by their own hash or by the id inside the verified refresh JWT, and checked against the calling user before revocation (ROV-92).',
  'apps/api-gateway/src/auth/repositories/refresh-token.drizzle-repository.ts#RefreshTokenDrizzleRepository.revoke':
    'Tokens are found by their own hash or by the id inside the verified refresh JWT, and checked against the calling user before revocation (ROV-92).',
  'apps/api-gateway/src/auth/repositories/refresh-token.drizzle-repository.ts#RefreshTokenDrizzleRepository.revokeAllForUser':
    'Keyed by the user id in the verified token.',
  'apps/api-gateway/src/auth/repositories/refresh-token.drizzle-repository.ts#RefreshTokenDrizzleRepository.revokeAllOtherForUser':
    'Keyed by the user id in the verified token.',
  'apps/api-gateway/src/auth/repositories/reseller-membership.drizzle-repository.ts#ResellerMembershipDrizzleRepository.findByUserId':
    'Login and token flow: looked up by the presented credential or by ids inside the verified token; nothing is returned before the credential check passes.',
  'apps/api-gateway/src/auth/repositories/user.drizzle-repository.ts#UserDrizzleRepository.findById':
    'Keyed by the user id in the verified token.',
  'apps/api-gateway/src/auth/repositories/user.drizzle-repository.ts#UserDrizzleRepository.findByUsername':
    'Login and token flow: looked up by the presented credential or by ids inside the verified token; nothing is returned before the credential check passes.',
  'apps/api-gateway/src/auth/repositories/user.drizzle-repository.ts#UserDrizzleRepository.getPreferredLocale':
    'Keyed by the user id in the verified token.',
  'apps/api-gateway/src/auth/repositories/user.drizzle-repository.ts#UserDrizzleRepository.updatePassword':
    'Keyed by the user id in the verified token.',
  'apps/api-gateway/src/auth/repositories/user.drizzle-repository.ts#UserDrizzleRepository.updatePreferredLocale':
    'Keyed by the user id in the verified token.',
  'apps/api-gateway/src/institute/academic-year/academic-year.service.ts#AcademicYearService.lookupInstituteType':
    'Keyed by the tenant id in the verified token. Reads only the institute type.',
  'apps/api-gateway/src/institute/bot/bot.service.ts#BotService.createBot':
    'Creates a new platform-level user for a bot in the token tenant.',
  'apps/api-gateway/src/institute/bot/bot.service.ts#BotService.deleteBot':
    'Revokes the membership id read from a bot profile fetched under tenant RLS.',
  'apps/api-gateway/src/institute/bot/bot.service.ts#BotService.findOrCreateBotRole':
    'Keyed by the tenant id in the verified token.',
  'apps/api-gateway/src/institute/certificate/repositories/export-report.drizzle-repository.ts#ExportReportDrizzleRepository.run':
    'Admin role only for a PlatformContext; the institute resolver passes its own InstituteContext from the token and runs under withTenant (cross-institute test in compliance-export.integration.spec.ts).',
  'apps/api-gateway/src/institute/group/group.service.ts#GroupService.listMembers':
    'Reads usernames for user ids taken from membership rows fetched under tenant RLS.',
  'apps/api-gateway/src/institute/guardian/guardian.service.ts#GuardianService.create':
    'Writes platform-level user tables for the user it just created.',
  'apps/api-gateway/src/institute/guardian/guardian.service.ts#GuardianService.update':
    'Writes platform-level user tables (no tenant RLS) for a user id taken from a row already read under tenant RLS. KNOWN GAP (ROV-292): the profile row is shared across institutes.',
  'apps/api-gateway/src/institute/institute-group/repositories/institute-group.drizzle-repository.ts#InstituteGroupDrizzleRepository.create':
    'Reseller scope passes its own reseller id from the token as owner; no existing group is read or changed.',
  'apps/api-gateway/src/institute/institute-group/repositories/institute-group.drizzle-repository.ts#InstituteGroupDrizzleRepository.findMembershipsByUser':
    'Keyed by the user id in the verified token.',
  'apps/api-gateway/src/institute/management/repositories/institute.drizzle-repository.ts#InstituteDrizzleRepository.create':
    'Reseller scope only: reseller id comes from the token and a named group must be owned by that reseller (assertOwnedByReseller).',
  'apps/api-gateway/src/institute/management/repositories/institute.drizzle-repository.ts#InstituteDrizzleRepository.findAffiliations':
    'Field resolver: an institute caller may only resolve its own institute (assertReadable); reseller and platform parents come from queries already scoped to the caller.',
  'apps/api-gateway/src/institute/management/repositories/institute.drizzle-repository.ts#InstituteDrizzleRepository.findBranding':
    'Field resolver: an institute caller may only resolve its own institute (assertReadable); reseller and platform parents come from queries already scoped to the caller.',
  'apps/api-gateway/src/institute/management/repositories/institute.drizzle-repository.ts#InstituteDrizzleRepository.findById':
    'Keyed by the tenant id in the verified token. The resolver takes no institute id argument.',
  'apps/api-gateway/src/institute/management/repositories/institute.drizzle-repository.ts#InstituteDrizzleRepository.findConfig':
    'Field resolver: an institute caller may only resolve its own institute (assertReadable); reseller and platform parents come from queries already scoped to the caller.',
  'apps/api-gateway/src/institute/management/repositories/institute.drizzle-repository.ts#InstituteDrizzleRepository.findIdentifiers':
    'Field resolver: an institute caller may only resolve its own institute (assertReadable); reseller and platform parents come from queries already scoped to the caller.',
  'apps/api-gateway/src/institute/management/repositories/institute.drizzle-repository.ts#InstituteDrizzleRepository.updateBranding':
    'Keyed by the tenant id in the verified token. The resolver takes no institute id argument.',
  'apps/api-gateway/src/institute/management/repositories/institute.drizzle-repository.ts#InstituteDrizzleRepository.updateConfig':
    'Keyed by the tenant id in the verified token. The resolver takes no institute id argument.',
  'apps/api-gateway/src/institute/management/repositories/institute.drizzle-repository.ts#InstituteDrizzleRepository.updateInfo':
    'Keyed by the tenant id in the verified token. The resolver takes no institute id argument.',
  'apps/api-gateway/src/institute/management/repositories/institute.drizzle-repository.ts#InstituteDrizzleRepository.updateLocales':
    'Keyed by the tenant id in the verified token. The resolver takes no institute id argument.',
  'apps/api-gateway/src/institute/management/repositories/institute.drizzle-repository.ts#InstituteDrizzleRepository.updateStatus':
    'Reseller scope only: called on the institute it just created, or after findByReseller proved ownership.',
  'apps/api-gateway/src/institute/staff/staff.service.ts#StaffService.create':
    'Writes platform-level user tables for the user it just created.',
  'apps/api-gateway/src/files/profile-photo.service.ts#ProfilePhotoService.set':
    'Writes the platform-level user profile (no tenant RLS) for a user id read from a student, staff or guardian row under tenant RLS, or taken from the verified token. The file must have been uploaded for that same user. Cross-institute refusal: profile-photo.api-e2e.spec.ts.',
  'apps/api-gateway/src/institute/student/student.service.ts#StudentService.applyUserProfileUpdates':
    'Writes platform-level user tables (no tenant RLS) for a user id taken from a row already read under tenant RLS. KNOWN GAP (ROV-292): the profile row is shared across institutes.',
  'apps/api-gateway/src/institute/student/student.service.ts#StudentService.create':
    'KNOWN GAP (ROV-292): reuses an existing user matched by phone number without consent. Otherwise writes rows for the user it just created.',
  'apps/api-gateway/src/institute/student/student.service.ts#StudentService.deleteDocument':
    'Soft-deletes a platform-level user document (no tenant RLS) only after reading it under tenant RLS joined to a student of the caller institute that the caller may read. Cross-institute refusal: student-document-removal.integration.spec.ts.',
  'apps/api-gateway/src/institute/student/student.service.ts#StudentService.uploadDocument':
    'Writes platform-level user tables (no tenant RLS) for a user id taken from a row already read under tenant RLS.',
  'apps/api-gateway/src/institute/user/profile.service.ts#ProfileService.getMyProfile':
    'Keyed by the user id in the verified token.',
  'apps/api-gateway/src/institute/user/profile.service.ts#ProfileService.updateMyProfile':
    'Keyed by the user id in the verified token.',
  'apps/api-gateway/src/passkey/repositories/auth-provider.drizzle-repository.ts#AuthProviderDrizzleRepository.countOtherPasskeys':
    'Keyed by the user id in the verified token.',
  'apps/api-gateway/src/passkey/repositories/auth-provider.drizzle-repository.ts#AuthProviderDrizzleRepository.create':
    'Keyed by the user id in the verified token.',
  'apps/api-gateway/src/passkey/repositories/auth-provider.drizzle-repository.ts#AuthProviderDrizzleRepository.deletePasskey':
    'Keyed by the user id in the verified token.',
  'apps/api-gateway/src/passkey/repositories/auth-provider.drizzle-repository.ts#AuthProviderDrizzleRepository.findByActiveUsername':
    'Passkey login: looked up by the username or credential id the authenticator presents; nothing is returned before the signature verifies.',
  'apps/api-gateway/src/passkey/repositories/auth-provider.drizzle-repository.ts#AuthProviderDrizzleRepository.findByCredentialId':
    'Passkey login: looked up by the username or credential id the authenticator presents; nothing is returned before the signature verifies.',
  'apps/api-gateway/src/passkey/repositories/auth-provider.drizzle-repository.ts#AuthProviderDrizzleRepository.findPasskeysByUserId':
    'Keyed by the user id in the verified token.',
  'apps/api-gateway/src/passkey/repositories/auth-provider.drizzle-repository.ts#AuthProviderDrizzleRepository.updateProviderData':
    'Passkey login: looked up by the username or credential id the authenticator presents; nothing is returned before the signature verifies.',
  'apps/api-gateway/src/reseller/team/repositories/reseller-team.drizzle-repository.ts#ResellerTeamDrizzleRepository.findLastActive':
    'Team (ROV-185): takes user ids the service read under withReseller for the caller token reseller; returns only a timestamp per id.',
  'apps/api-gateway/src/reseller/team/repositories/reseller-team.drizzle-repository.ts#ResellerTeamDrizzleRepository.listRoles':
    'Team (ROV-185): filters on the reseller id from the caller token; no caller-supplied id.',
  'apps/api-gateway/src/reseller/team/repositories/reseller-team.drizzle-repository.ts#ResellerTeamDrizzleRepository.listSessions':
    'Team (ROV-185): takes a membership id the service first found under withReseller for the caller token reseller.',
  'ee/libs/backend/payments/src/repositories/payment-gateway-config.drizzle-repository.ts#PaymentGatewayConfigDrizzleRepository.findActiveByResellerId':
    'Keyed by the reseller id in the verified token.',
  'libs/backend/casl/src/repositories/membership-ability.drizzle-repository.ts#MembershipAbilityDrizzleRepository.findAbilities':
    'Loads abilities for the membership id and tenant id in the verified token.',
  'libs/backend/casl/src/repositories/membership-ability.drizzle-repository.ts#MembershipAbilityDrizzleRepository.findReadAssignments':
    'Loads abilities for the membership id and tenant id in the verified token.',
  'libs/backend/casl/src/repositories/role.drizzle-repository.ts#RoleDrizzleRepository.findAbilities':
    'Loads abilities for the role id in the verified token.',
  'libs/backend/casl/src/repositories/role.drizzle-repository.ts#RoleDrizzleRepository.findPrimaryNavSlugs':
    'Loads abilities for the role id in the verified token.',
};

// Reached admin-context file with no function found by the method analysis (reached through
// a dataloader, a module binding or a re-export) → why it is safe.
export const ADMIN_REACH_ALLOWLIST: Readonly<Record<string, string>> = {
  'apps/api-gateway/src/files/file.loaders.ts':
    'Reached through a dataloader that runs as the role of the request scope; the admin branch runs only for a platform-scope token.',
  'apps/api-gateway/src/files/file-purge.repository.ts':
    'Bound in FilesModule for FileSweeper; reached only by the sweeper workflow and FileService.purge (server workflows), which no resolver calls.',
  'apps/api-gateway/src/institute/management/seed/institute-setup.service.ts':
    'Imported by InstituteService; runs only from institute activation, which no non-admin resolver method calls.',
  'ee/apps/api-gateway/src/billing/repositories/subscription.repository.ts':
    'Reached through a dataloader: counts subscribers for plan ids already returned to the caller by a reseller-scoped query.',
  'libs/backend/casl/src/seed-roles.ts':
    'Imported with the casl library; seeds default roles for a tenant chosen by institute creation, not by a request argument.',
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

/** Keys found but not listed, and keys listed but no longer found. */
export function diffAllowlist(
  found: Iterable<string>,
  allowlist: Readonly<Record<string, string>>,
): { unlisted: string[]; stale: string[] } {
  const foundSet = new Set(found);
  return {
    unlisted: [...foundSet].filter((key) => !(key in allowlist)).sort(),
    stale: Object.keys(allowlist)
      .filter((key) => !foundSet.has(key))
      .sort(),
  };
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
  const methods = collectAdminMethods(
    roots,
    [...reach.keys()].map((file) => join(ROOT, file)),
    compilerOptions,
    ROOT,
  );
  const methodDiff = diffAllowlist(methods.keys(), ADMIN_METHOD_ALLOWLIST);

  // Files the method analysis already covers need no file-level entry.
  const covered = new Set([...methods.keys()].map((key) => key.split('#')[0]));
  const uncovered = new Map([...reach].filter(([file]) => !covered.has(file)));
  const fileDiff = findViolations(uncovered, ADMIN_REACH_ALLOWLIST);

  const clean =
    methodDiff.unlisted.length + methodDiff.stale.length === 0 &&
    fileDiff.unlisted.length + fileDiff.stale.length === 0;
  if (clean) {
    process.stdout.write(
      `check:admin-context-reach — ${methods.size} admin-context function(s) and ${Object.keys(ADMIN_REACH_ALLOWLIST).length} file(s) reachable from non-admin resolvers, all listed with a reason.\n`,
    );
    return 0;
  }

  const err = (text: string) => process.stderr.write(text);
  if (methodDiff.unlisted.length > 0) {
    err(
      `check:admin-context-reach — ${methodDiff.unlisted.length} admin-context function(s) newly reachable from a non-admin resolver:\n\n`,
    );
    for (const key of methodDiff.unlisted) {
      err(`  ${key}\n    reached from ${methods.get(key)}\n`);
    }
    err(
      '\nThese run queries as roviq_admin (RLS bypassed). An id the caller supplies must be checked against the\n' +
        'caller’s tenant or reseller first, or the query must move to withTenant / withReseller. Add a cross-tenant\n' +
        'test, then list the function in ADMIN_METHOD_ALLOWLIST with the reason.\n',
    );
  }
  if (fileDiff.unlisted.length > 0) {
    err(
      `\ncheck:admin-context-reach — ${fileDiff.unlisted.length} admin-context file(s) reachable with no function resolved:\n\n`,
    );
    for (const hit of fileDiff.unlisted) err(`  ${hit.file}\n    reached from ${hit.root}\n`);
    err(
      '\nCheck how the file is reached, then list it in ADMIN_REACH_ALLOWLIST with the reason.\n',
    );
  }
  const stale = [...methodDiff.stale, ...fileDiff.stale];
  if (stale.length > 0) {
    err(
      `\ncheck:admin-context-reach — ${stale.length} allowlist entr${stale.length === 1 ? 'y is' : 'ies are'} no longer reached; remove:\n\n`,
    );
    for (const key of stale) err(`  ${key}\n`);
  }
  return 1;
}

if (process.argv[1]?.endsWith('check-admin-context-reach.ts')) {
  process.exit(main());
}
