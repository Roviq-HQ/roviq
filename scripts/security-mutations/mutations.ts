/**
 * The curated mutations of the security mutation run. Row policies and same-tenant foreign
 * keys are not listed: the run finds them in the catalog (`scripts/security-mutations.ts`).
 *
 * Add a line when a database rule or a code check is added. A name says which rule is
 * weakened, never what was once possible without it.
 */
import type { CodeMutation, DatabaseChange, DatabaseMutation } from './plan';

const DB = 'libs/database/src/__tests__';
const GATEWAY = 'apps/api-gateway/src';

/** Compares the catalog with a text file, so it fails on any policy or grant change. */
export const MANIFEST_SPEC = `${DB}/privilege-manifest.integration.spec.ts`;
/** Tries a foreign row on a copy of every table, as each role, through the role's own policies. */
export const ROW_POLICY_SPEC = `${DB}/row-policies-refuse-foreign-rows.integration.spec.ts`;
/** Attempts every same-tenant foreign key as the platform role. */
export const FOREIGN_KEY_SPEC = `${DB}/same-tenant-foreign-keys.integration.spec.ts`;
/** The specs that attempt a forbidden statement as a database role. */
export const DATABASE_SPECS = DB;

const rule = (name: string, change: DatabaseChange, specs: string[] = []): DatabaseMutation => ({
  type: 'database',
  name,
  group: 'rules',
  changes: [change],
  specs,
  thenWholeProject: true,
});

const triggerOff = (table: string, trigger: string): DatabaseMutation =>
  rule(`trigger ${trigger} off`, { kind: 'trigger-off', table, trigger });

const grant = (
  privilege: string,
  table: string,
  role: string,
  columns?: string[],
): DatabaseMutation =>
  rule(`grant ${privilege}${columns ? ` (${columns.join(', ')})` : ''} on ${table} to ${role}`, {
    kind: 'grant',
    privilege,
    table,
    role,
    columns,
  });

export const RULE_MUTATIONS: DatabaseMutation[] = [
  // Who may be added to an institute, and what a membership may become.
  triggerOff('memberships', 'memberships_guard_user'),
  triggerOff('memberships', 'memberships_keep_user_and_tenant'),
  triggerOff('memberships', 'memberships_keep_full_control_member'),
  triggerOff('memberships', 'memberships_revoke_sessions'),
  triggerOff('users', 'users_keep_origin_tenant'),
  rule('constraint chk_membership_not_ended_by_self dropped', {
    kind: 'constraint-drop',
    table: 'memberships',
    constraint: 'chk_membership_not_ended_by_self',
  }),

  // Sessions and impersonation.
  triggerOff('refresh_tokens', 'refresh_tokens_guard'),
  triggerOff('impersonation_sessions', 'impersonation_sessions_guard'),
  triggerOff('users', 'users_revoke_sessions_on_password_change'),
  triggerOff('resellers', 'resellers_revoke_sessions'),
  triggerOff('resellers', 'resellers_protect_system'),
  triggerOff('reseller_memberships', 'reseller_memberships_revoke_sessions'),
  rule('constraint chk_refresh_token_membership_scope dropped', {
    kind: 'constraint-drop',
    table: 'refresh_tokens',
    constraint: 'chk_refresh_token_membership_scope',
  }),

  // Records that are only appended to, and rows only the platform removes.
  triggerOff('auth_events', 'auth_events_append_only'),
  triggerOff('audit_logs', 'trg_audit_logs_check_subject_tenant'),
  triggerOff('institutes', 'institutes_delete_admin_only_update'),
  triggerOff('year_rollover_section_map', 'trg_year_rollover_section_map_check_sections'),

  // Privileges. The first is noticed only by the comparison with the manifest file; the others
  // by a spec that attempts the statement as the role.
  rule(
    'grant DELETE on student_profiles to roviq_app (manifest comparison)',
    { kind: 'grant', privilege: 'DELETE', table: 'student_profiles', role: 'roviq_app' },
    [MANIFEST_SPEC],
  ),
  grant('INSERT', 'audit_logs', 'roviq_app'),
  grant('INSERT', 'audit_logs', 'roviq_reseller'),
  grant('UPDATE', 'institutes', 'roviq_app', ['code']),
  grant('UPDATE', 'institutes', 'roviq_reseller', ['status']),
  grant('INSERT', 'institutes', 'roviq_reseller'),
  grant('SELECT', 'platform_memberships', 'roviq_app'),
  grant('SELECT', 'reseller_memberships', 'roviq_app'),
  grant('SELECT', 'users', 'roviq_app', ['password_hash']),
  grant('SELECT', 'users', 'roviq_app', ['origin_tenant_id']),
  grant('UPDATE', 'users', 'roviq_app', ['origin_tenant_id']),
  grant('SELECT', 'dlq_messages', 'roviq_app'),
  grant('INSERT', 'impersonation_sessions', 'roviq_app'),
  grant('DELETE', 'files', 'roviq_reseller'),
  grant('UPDATE', 'resellers', 'roviq_reseller', ['status']),
];

const code = (
  patch: string,
  specs: string[],
  project: CodeMutation['project'] = 'integration',
): CodeMutation => ({
  type: 'code',
  name: project === 'integration' ? patch : `${patch} (${project})`,
  patch,
  group: 'code',
  project,
  specs,
});

/**
 * Each entry applies `patches/<patch>.patch`: a small change that removes one check from the
 * code. The specs are the ones that must fail while the patch is applied. A patch is made by
 * editing the code, saving `git diff -- <file>` under the name of the rule, and undoing the edit.
 */
export const CODE_MUTATIONS: CodeMutation[] = [
  // The guard refuses a role with a row condition on an operation that applies none.
  code(
    'ability-guard-row-scope',
    ['libs/backend/casl/src/__tests__/ability.guard.spec.ts'],
    'unit-node',
  ),
  code('ability-guard-row-scope', [`${GATEWAY}/__tests__/casl-enforcement.integration.spec.ts`]),
  // An operation declared `rows: 'scoped'` applies the caller's conditions to its query.
  code('student-list-row-predicate', [
    `${GATEWAY}/__tests__/student-read-authorization.integration.spec.ts`,
  ]),
  code('guardian-permissions-live-links', [
    `${GATEWAY}/institute/guardian/__tests__/guardian-foreign-id.integration.spec.ts`,
    `${GATEWAY}/institute/attendance/__tests__/attendance-authorization.integration.spec.ts`,
  ]),
  // Own-account statements run as the person, and not in an impersonation session.
  code('own-account-impersonation-refusal', [
    `${GATEWAY}/auth/__tests__/own-account-impersonation.integration.spec.ts`,
  ]),
  code('own-account-role', [
    `${GATEWAY}/auth/__tests__/own-account-impersonation.integration.spec.ts`,
    `${GATEWAY}/notification-inbox/__tests__/notification-inbox.integration.spec.ts`,
  ]),
  // A result that carries another institute's id is found and refused.
  code(
    'response-scope-finder',
    [`${GATEWAY}/common/response-scope/__tests__/foreign-scope-finder.spec.ts`],
    'unit-node',
  ),
  code('response-scope-finder', [
    `${GATEWAY}/common/response-scope/__tests__/response-scope.integration.spec.ts`,
  ]),
  code('response-scope-refusal', [
    `${GATEWAY}/common/response-scope/__tests__/response-scope.integration.spec.ts`,
  ]),
  // Ownership checks before a statement that runs with wider rights.
  code('membership-end-needs-full-control', [
    `${GATEWAY}/__tests__/membership-ends-with-last-profile.integration.spec.ts`,
  ]),
  code('impersonation-target-of-reseller', [
    `${GATEWAY}/auth/__tests__/impersonation.integration.spec.ts`,
  ]),
  code('reseller-institute-group-owner', [
    `${GATEWAY}/reseller/__tests__/reseller-foreign-id.integration.spec.ts`,
    `${GATEWAY}/reseller/institute-group/__tests__/reseller-institute-group.integration.spec.ts`,
  ]),
  // The two-institute scan itself. Needs the e2e stack: run with --e2e after `pnpm e2e:up`.
  code(
    'two-institute-response-scanner',
    ['e2e/api-gateway-e2e/src/two-institute.api-e2e.spec.ts'],
    'e2e-api',
  ),
];
