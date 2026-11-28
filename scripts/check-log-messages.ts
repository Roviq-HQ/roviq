// CI guard — a log record's fields come from a written list (LOG_FIELDS), but its message is
// free text. This check keeps personal data and error text out of that text:
//   - a value whose name says it is personal, secret or typed by a user is not interpolated;
//   - an error is passed as `{ err }`, so the listed error serializer writes it, never
//     interpolated into the message and never as a second argument (which pino drops);
//   - `console.*` is not used: it writes past the listed logger.
// The rule in words: docs/deployment.md → "Telemetry and shutdown".

import { type Dirent, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { LOG_FIELDS } from '../libs/backend/telemetry/src/log-fields';

const ROOT = process.cwd();
const SCAN_ROOTS = [
  'apps/api-gateway/src',
  'apps/notification-service/src',
  'ee',
  'libs/backend',
  'libs/database/src',
];

export type LogRule =
  | 'personal-value'
  | 'error-in-message'
  | 'error-as-argument'
  | 'console-call'
  | 'unlisted-field';

export interface LogHit {
  rule: LogRule;
  file: string;
  line: number;
  /** The expression the rule objects to. */
  detail: string;
}

/** Calls allowed past one rule, each with the reason. Key: `<file>#<rule>`. */
export const LOG_MESSAGE_ALLOWLIST: Readonly<Record<string, string>> = {};

const MESSAGE: Readonly<Record<LogRule, string>> = {
  'personal-value':
    'A log message quotes a value that is personal, secret or typed by a user. Log the id of the row instead, or leave the value out.',
  'error-in-message':
    'An error is interpolated into a log message. Pass it as the first argument, `logger.error({ err }, "what failed")`, so only its type, message, stack and code are written.',
  'error-as-argument':
    'An error is passed after the message, where the logger drops it. Pass it as the first argument: `logger.error({ err }, "what failed")`.',
  'console-call':
    'console.* writes past the listed logger. Use `new Logger(X.name)` from @nestjs/common.',
  'unlisted-field':
    'This field is not in LOG_FIELDS (libs/backend/telemetry/src/log-fields.ts), so the logger drops it. List it there if it holds an id, a code or a count; otherwise remove it.',
};

/** Last segments that name a person or a secret, compared in lower case as a suffix. */
const PERSONAL_SUFFIXES = [
  'phone',
  'mobile',
  'email',
  'password',
  'passwd',
  'secret',
  'token',
  'otp',
  'address',
  'aadhaar',
  'dateofbirth',
  'dob',
  // Text a user typed.
  'reason',
  'remark',
  'remarks',
  'notes',
  'comment',
];

/** Names compared whole: `stream.name` and `info.fieldName` are names from the code. */
const PERSONAL_NAMES = new Set([
  'firstname',
  'lastname',
  'middlename',
  'fullname',
  'displayname',
  'studentname',
  'parentname',
  'guardianname',
  'fathername',
  'mothername',
  'username',
  // The values of a database query.
  'params',
]);

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

type Mode = 'code' | "'" | '"' | '`' | 'line' | 'block';

interface Frame {
  mode: Mode;
  /** Open braces inside a `${ … }` of a template; the brace that closes it ends the frame. */
  braces: number;
}

/** One step through code: returns how many characters it consumed. */
function stepCode(text: string, i: number, stack: Frame[], frame: Frame): number {
  const ch = text[i];
  const next = text[i + 1];
  if (ch === '/' && next === '/') {
    stack.push({ mode: 'line', braces: 0 });
    return 2;
  }
  if (ch === '/' && next === '*') {
    stack.push({ mode: 'block', braces: 0 });
    return 2;
  }
  if (ch === "'" || ch === '"' || ch === '`') stack.push({ mode: ch, braces: 0 });
  else if (ch === '{') frame.braces++;
  else if (ch === '}' && stack.length > 1 && frame.braces-- === 0) stack.pop();
  return 1;
}

/** One step through a string, a template's text or a comment. */
function stepText(text: string, i: number, stack: Frame[], mode: Mode): number {
  const ch = text[i];
  if (mode === 'line') {
    if (ch === '\n') stack.pop();
    return 1;
  }
  if (mode === 'block') {
    if (ch !== '*' || text[i + 1] !== '/') return 1;
    stack.pop();
    return 2;
  }
  if (ch === '\\') return 2;
  if (mode === '`' && ch === '$' && text[i + 1] === '{') {
    stack.push({ mode: 'code', braces: 0 });
    return 2;
  }
  if (ch === mode) stack.pop();
  return 1;
}

/**
 * The text with everything that is not code blanked out: comments, strings and the text of
 * templates become spaces; the expressions inside `${ … }` stay. Same length as the input.
 */
export function codeOnly(text: string): string {
  const out: string[] = [];
  const stack: Frame[] = [{ mode: 'code', braces: 0 }];
  let i = 0;
  while (i < text.length) {
    const frame = stack[stack.length - 1] ?? { mode: 'code', braces: 0 };
    const before = stack.length;
    const isCode = frame.mode === 'code';
    const used = isCode ? stepCode(text, i, stack, frame) : stepText(text, i, stack, frame.mode);
    // A character that opens or closes a string, template hole or comment is not code.
    const keep = isCode && stack.length === before;
    for (let k = 0; k < used && i + k < text.length; k++) {
      const ch = text[i + k] ?? '';
      out.push(keep || ch === '\n' ? ch : ' ');
    }
    i += used;
  }
  return out.join('');
}

export interface LogCall {
  receiver: string;
  line: number;
  /** The call's arguments, as written. */
  args: string[];
}

const LOG_CALL =
  /(?<![\w$.])(?:this\s*\.\s*)?([A-Za-z_$]*[lL]ogger|log|console)\s*\.\s*(?:log|warn|error|debug|verbose|info|fatal|trace)\s*\(/g;

/** Where the argument list opened at `from` ends, and where its top-level commas are. */
function argumentSpans(code: string, from: number): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let depth = 1;
  let start = from;
  let i = from;
  for (; i < code.length && depth > 0; i++) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 1) {
      spans.push([start, i]);
      start = i + 1;
    }
  }
  spans.push([start, i - 1]);
  return spans;
}

/** Every call of a logger or of `console` in the text. */
export function findLogCalls(text: string): LogCall[] {
  const code = codeOnly(text);
  const calls: LogCall[] = [];
  for (const match of code.matchAll(LOG_CALL)) {
    const open = match.index + match[0].length;
    const args = argumentSpans(code, open)
      .map(([start, end]) => text.slice(start, end).trim())
      .filter((arg) => arg.length > 0);
    calls.push({
      receiver: match[1] ?? '',
      line: text.slice(0, match.index).split('\n').length,
      args,
    });
  }
  return calls;
}

/** The expressions inside the `${ … }` holes of a template. */
export function interpolations(template: string): string[] {
  return [...template.matchAll(/\$\{((?:[^{}]|\{[^{}]*\})*)\}/g)].map((match) => match[1] ?? '');
}

const ERROR_NAME =
  /(?<![.\w$])(?:e|err|error|ex|exception|cause|[a-z][\w$]*(?:Err|Error))\b(?!\s*\.\s*(?:code|name|status|statusCode|provider|errorCode|kind)\b)(?!\s*[:(])/;

/** True when the expression reads an error itself, its message or its stack. */
export function readsAnError(expression: string): boolean {
  const code = codeOnly(expression).replace(/[\w$]+\s+instanceof\s+[\w$.]+/g, '');
  return ERROR_NAME.test(code);
}

function isPersonalName(identifier: string): boolean {
  const name = identifier.toLowerCase().replace(/_/g, '');
  return PERSONAL_NAMES.has(name) || PERSONAL_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/**
 * True when the expression names a personal value. For a plain member chain only the last
 * segment counts (`existingByEmail[0].id` is an id); otherwise every identifier does.
 */
export function namesPersonalValue(expression: string): boolean {
  const code = codeOnly(expression);
  const identifiers = code.match(/[A-Za-z_$][\w$]*/g) ?? [];
  if (/^[\w$.?![\]\s]+$/.test(code)) {
    const last = identifiers[identifiers.length - 1];
    return last !== undefined && isPersonalName(last);
  }
  return identifiers.some(isPersonalName);
}

type Problem = Pick<LogHit, 'rule' | 'detail'>;

function messageProblems(argument: string): Problem[] {
  const problems: Problem[] = [];
  for (const expression of interpolations(argument)) {
    if (readsAnError(expression)) problems.push({ rule: 'error-in-message', detail: expression });
    else if (namesPersonalValue(expression)) {
      problems.push({ rule: 'personal-value', detail: expression });
    }
  }
  return problems;
}

/** The keys written at the top level of an object literal; a spread is not followed. */
export function objectKeys(literal: string): string[] {
  const inner = literal.slice(1, literal.lastIndexOf('}'));
  return argumentSpans(`${inner})`, 0)
    .map(([start, end]) => inner.slice(start, end).trim())
    .filter((entry) => entry.length > 0 && !entry.startsWith('...'))
    .map((entry) => /^(['"`]?)([\w$.]+)\1\s*(?::|$)/.exec(entry)?.[2])
    .filter((key): key is string => key !== undefined);
}

function fieldProblems(literal: string): Problem[] {
  return objectKeys(literal)
    .filter((key) => !LOG_FIELDS.has(key))
    .map((key) => ({ rule: 'unlisted-field', detail: key }));
}

function argumentProblems(argument: string): Problem[] {
  const first = argument[0];
  // An object holds fields: only the ones in LOG_FIELDS are written.
  if (first === '{') return fieldProblems(argument);
  if (first === '`' || first === "'" || first === '"') return messageProblems(argument);
  const problems = messageProblems(argument);
  if (readsAnError(argument)) problems.push({ rule: 'error-as-argument', detail: argument });
  return problems;
}

/** What one file's log calls do wrong. `file` is the path relative to the repository root. */
export function findLogProblems(file: string, text: string): LogHit[] {
  const hits: LogHit[] = [];
  for (const call of findLogCalls(text)) {
    const problems: Problem[] =
      call.receiver === 'console'
        ? [{ rule: 'console-call', detail: 'console' }]
        : call.args.flatMap(argumentProblems);
    for (const problem of problems) hits.push({ ...problem, file, line: call.line });
  }
  return hits;
}

export function findLogHits(
  projectRoot: string = ROOT,
  allowlist: Readonly<Record<string, string>> = LOG_MESSAGE_ALLOWLIST,
): LogHit[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) walk(join(projectRoot, root), files);
  return files.flatMap((full) => {
    const file = relative(projectRoot, full).replace(/\\/g, '/');
    return findLogProblems(file, readFileSync(full, 'utf8')).filter(
      (hit) => allowlist[`${file}#${hit.rule}`] === undefined,
    );
  });
}

function main(): number {
  const hits = findLogHits();
  if (hits.length === 0) {
    process.stdout.write(
      'check:log-messages — no log message quotes a personal value or an error, and nothing logs through console.\n',
    );
    return 0;
  }
  process.stderr.write(`check:log-messages — ${hits.length} problem(s):\n\n`);
  for (const hit of hits) {
    process.stderr.write(`  ${hit.file}:${hit.line}  ${hit.detail}\n    ${MESSAGE[hit.rule]}\n`);
  }
  process.stderr.write(
    '\nA call that is right as it is goes in LOG_MESSAGE_ALLOWLIST (scripts/check-log-messages.ts) with its reason.\n',
  );
  return 1;
}

if (process.argv[1]?.endsWith('check-log-messages.ts')) {
  process.exit(main());
}
