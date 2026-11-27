// CI guard — the stores row security does not cover (Redis, Temporal, object storage,
// GraphQL subscriptions, in-process loaders) are scoped only by the names and filters the
// code gives them. Each rule below keeps one of them in the one place that scopes it.
// The rule in words: docs/architecture.md → "Stores outside PostgreSQL".

import { type Dirent, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_ROOTS = ['apps/api-gateway/src', 'apps/notification-service/src', 'ee', 'libs/backend'];

export type StoreRule =
  | 'redis-inline-key'
  | 'shared-loader'
  | 'workflow-handle'
  | 'subscription-filter'
  | 'storage-outside-files';

export interface StoreHit {
  rule: StoreRule;
  file: string;
}

/** Files allowed past one rule, each with the reason. */
export const STORE_KEY_ALLOWLIST: Readonly<Record<string, { rule: StoreRule; reason: string }>> = {
  'libs/backend/temporal/src/temporal-client.service.ts': {
    rule: 'workflow-handle',
    reason: 'The library method itself; its callers are checked.',
  },
  'apps/notification-service/src/services/flow-arrivals.service.ts': {
    rule: 'workflow-handle',
    reason:
      'The flow id is read from the notification row of the recipient the report is for; no request supplies it.',
  },
  'apps/api-gateway/src/notification-inbox/notification-inbox.resolver.ts': {
    rule: 'subscription-filter',
    reason: 'The topic is built from the signed-in user id, so nobody else is subscribed to it.',
  },
  'apps/api-gateway/src/auth/repositories/membership.drizzle-repository.ts': {
    rule: 'storage-outside-files',
    reason: 'Public URL of an institute logo, from the file row joined in the same query.',
  },
};

const MESSAGE: Readonly<Record<StoreRule, string>> = {
  'redis-inline-key':
    "A Redis key is typed inline. Name its prefix in a key constant (REDIS_KEYS, or the library's own constant) and say there what the key is keyed by.",
  'shared-loader':
    'A DataLoader lives in a provider that is not request-scoped and caches. Make the provider `Scope.REQUEST`, or pass `cache: false`.',
  'workflow-handle':
    "A workflow handle or signal is used without `isTenantWorkflowId(...)`. Build the id with `tenantWorkflowId` and check it against the caller's institute first.",
  'subscription-filter':
    'A subscription outside `admin/` has no `filter`. Filter on the institute or reseller of the payload against the token.',
  'storage-outside-files':
    "The storage client is called outside the files module. Go through FileService or WorkflowFileStore, which read the file row under the caller's context first.",
};

function walk(dir: string, out: string[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const { name } = entry;
    if (
      name === 'node_modules' ||
      name === 'dist' ||
      name === '__tests__' ||
      name.startsWith('.')
    ) {
      continue;
    }
    const full = join(dir, name);
    if (entry.isDirectory()) walk(full, out);
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
}

/** Where the comment starting at `i` ends, or -1 when no comment starts there. */
function commentEnd(text: string, i: number): number {
  if (text[i] !== '/') return -1;
  if (text[i + 1] === '/') {
    const end = text.indexOf('\n', i);
    return end === -1 ? text.length : end;
  }
  if (text[i + 1] === '*') {
    const end = text.indexOf('*/', i + 2);
    return end === -1 ? text.length : end + 2;
  }
  return -1;
}

/** Removes comments, keeping string contents: the rules look inside decorators and calls. */
export function stripComments(text: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < text.length) {
    const ch = text[i] ?? '';
    if (quote) {
      const escaped = ch === '\\';
      out += escaped ? ch + (text[i + 1] ?? '') : ch;
      if (!escaped && ch === quote) quote = null;
      i += escaped ? 2 : 1;
      continue;
    }
    const end = commentEnd(text, i);
    if (end !== -1) {
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    out += ch;
    i++;
  }
  return out;
}

// `eval` takes a script, and `redis.call('GET', KEYS[1])` is Lua inside one.
const REDIS_INLINE_KEY = /\bredis\s*\.\s*(?!eval\b|call\b|pcall\b)\w+\(\s*[`'"][A-Za-z]/;
const WORKFLOW_HANDLE = /\bworkflow\s*\.\s*getHandle\(|\btemporal\s*\.\s*signal\(/;
const STORAGE_OBJECT_CALL =
  /\bstorage\s*\.\s*(?:presignPut|presignGet|publicUrl|put|copy|head|getRange|get|delete)\(/;

/** The text of each `@Subscription(...)` decorator call, parentheses balanced. */
export function subscriptionDecorators(source: string): string[] {
  const found: string[] = [];
  let from = source.indexOf('@Subscription(');
  while (from !== -1) {
    let depth = 0;
    let end = from + '@Subscription'.length;
    for (; end < source.length; end++) {
      if (source[end] === '(') depth++;
      else if (source[end] === ')' && --depth === 0) break;
    }
    found.push(source.slice(from, end + 1));
    from = source.indexOf('@Subscription(', end);
  }
  return found;
}

/** The rules one file breaks. `file` is the path relative to the repository root. */
export function findStoreRuleBreaks(file: string, text: string): StoreRule[] {
  const source = stripComments(text);
  const broken: StoreRule[] = [];

  if (REDIS_INLINE_KEY.test(source)) broken.push('redis-inline-key');

  if (
    source.includes('new DataLoader') &&
    !source.includes('Scope.REQUEST') &&
    !/cache:\s*false/.test(source)
  ) {
    broken.push('shared-loader');
  }

  if (WORKFLOW_HANDLE.test(source) && !source.includes('isTenantWorkflowId(')) {
    broken.push('workflow-handle');
  }

  if (
    !file.includes('/admin/') &&
    subscriptionDecorators(source).some((decorator) => !/\bfilter\s*:/.test(decorator))
  ) {
    broken.push('subscription-filter');
  }

  if (
    STORAGE_OBJECT_CALL.test(source) &&
    !file.startsWith('apps/api-gateway/src/files/') &&
    !file.startsWith('libs/backend/storage/')
  ) {
    broken.push('storage-outside-files');
  }

  return broken;
}

export function findStoreHits(
  projectRoot: string = ROOT,
  allowlist: Readonly<Record<string, { rule: StoreRule }>> = STORE_KEY_ALLOWLIST,
): StoreHit[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) walk(join(projectRoot, root), files);
  const hits: StoreHit[] = [];
  for (const full of files) {
    const file = relative(projectRoot, full).replace(/\\/g, '/');
    for (const rule of findStoreRuleBreaks(file, readFileSync(full, 'utf8'))) {
      if (allowlist[file]?.rule !== rule) hits.push({ rule, file });
    }
  }
  return hits;
}

function main(): number {
  const hits = findStoreHits();
  if (hits.length === 0) {
    process.stdout.write(
      'check:store-keys — Redis keys, workflow handles, loaders, subscriptions and storage calls are scoped in their one place.\n',
    );
    return 0;
  }
  process.stderr.write(`check:store-keys — ${hits.length} problem(s):\n\n`);
  for (const hit of hits) process.stderr.write(`  ${hit.file}\n    ${MESSAGE[hit.rule]}\n`);
  process.stderr.write(
    '\nA file that is right as it is goes in STORE_KEY_ALLOWLIST (scripts/check-store-keys.ts) with its reason.\n',
  );
  return 1;
}

if (process.argv[1]?.endsWith('check-store-keys.ts')) {
  process.exit(main());
}
