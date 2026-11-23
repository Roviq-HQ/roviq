// CI guard for the documentation rules in docs/README.md:
//   1. a relative Markdown link points at a tracked file or directory,
//   2. a repository path in backticks (`apps/…`, `libs/…`, `docs/…`) exists,
//   3. every Markdown file under docs/ is linked from docs/README.md.
// Paths are checked against `git ls-files`, so a file that exists only on one machine fails.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

export interface Problem {
  file: string;
  line: number;
  message: string;
}

const PATH_ROOTS = ['apps', 'libs', 'ee', 'e2e', 'scripts', 'docker', 'tools', 'tests', 'docs'];
const INDEX = 'docs/README.md';
// Append-only history: old entries keep the paths that were true when they were written.
const HISTORY_PREFIX = 'docs/changelogs/';
// Vendored agent tooling, not project documentation.
const IGNORED_PREFIXES = ['.github/'];

const LINK_RE = /\[(?:[^[\]]|\[[^\]]*\])*\]\((?:<([^>]+)>|((?:[^()\s]|\([^()]*\))+))\)/g;
const CODE_PATH_RE = new RegExp(`\`((?:${PATH_ROOTS.join('|')})/[^\`\\s]+)\``, 'g');
const INLINE_CODE_RE = /`[^`]*`/g;
const PLACEHOLDER_RE = /[*<>{}$…]|\.\.\./;

/** Lines of `text` with fenced code blocks blanked, so examples are not checked. */
export function proseLines(text: string): string[] {
  let fenced = false;
  return text.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return '';
    }
    return fenced ? '' : line;
  });
}

function isExternal(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#');
}

/** Problems in one Markdown file. `exists` answers for a repo-relative path. */
export function checkFile(
  file: string,
  text: string,
  exists: (path: string) => boolean,
): Problem[] {
  const problems: Problem[] = [];
  proseLines(text).forEach((line, index) => {
    for (const match of line.replace(INLINE_CODE_RE, '').matchAll(LINK_RE)) {
      const target = (match[1] ?? match[2] ?? '').split('#')[0];
      if (!target || isExternal(match[1] ?? match[2] ?? '')) continue;
      const resolved = posix.normalize(posix.join(posix.dirname(file), decodeURI(target)));
      if (!exists(resolved.replace(/\/$/, ''))) {
        problems.push({ file, line: index + 1, message: `link target not found: ${target}` });
      }
    }
    for (const match of line.matchAll(CODE_PATH_RE)) {
      const raw = match[1];
      if (PLACEHOLDER_RE.test(raw)) continue;
      const path = raw.replace(/:\d+(-\d+)?$/, '').replace(/[/.,]+$/, '');
      if (!exists(path)) {
        problems.push({ file, line: index + 1, message: `path not found: ${raw}` });
      }
    }
  });
  return problems;
}

/** Markdown files under docs/ that the index does not link to. */
export function unlistedDocs(files: string[], indexText: string): string[] {
  const linked = new Set<string>();
  for (const line of proseLines(indexText)) {
    for (const match of line.replace(INLINE_CODE_RE, '').matchAll(LINK_RE)) {
      const target = (match[1] ?? match[2] ?? '').split('#')[0];
      if (target && !isExternal(target)) {
        linked.add(posix.normalize(posix.join(posix.dirname(INDEX), target)));
      }
    }
  }
  return files.filter(
    (file) =>
      file.startsWith('docs/') && file.endsWith('.md') && file !== INDEX && !linked.has(file),
  );
}

/** Every problem in the given Markdown files. `read` returns a file's text. */
export function checkDocs(trackedFiles: string[], read: (file: string) => string): Problem[] {
  const known = new Set<string>(trackedFiles);
  for (const file of trackedFiles) {
    for (let dir = posix.dirname(file); dir !== '.'; dir = posix.dirname(dir)) known.add(dir);
  }
  const exists = (path: string): boolean => known.has(path);

  const markdown = trackedFiles.filter(
    (file) => file.endsWith('.md') && !IGNORED_PREFIXES.some((prefix) => file.startsWith(prefix)),
  );
  const problems = markdown
    .filter((file) => !file.startsWith(HISTORY_PREFIX))
    .flatMap((file) => checkFile(file, read(file), exists));

  if (known.has(INDEX)) {
    for (const file of unlistedDocs(markdown, read(INDEX))) {
      problems.push({ file, line: 1, message: `not linked from ${INDEX}` });
    }
  } else {
    problems.push({ file: INDEX, line: 1, message: 'the documentation index is missing' });
  }
  return problems;
}

function main(): void {
  // Tracked and new-but-not-ignored files that still exist in the working tree.
  const list = (args: string[]): string[] =>
    execFileSync('git', ['ls-files', '-z', ...args], { encoding: 'utf-8' })
      .split('\0')
      .filter(Boolean);
  const deleted = new Set(list(['--deleted']));
  const files = [...list([]), ...list(['--others', '--exclude-standard'])].filter(
    (file) => !deleted.has(file),
  );

  const problems = checkDocs(files, (file) => readFileSync(file, 'utf-8'));
  if (problems.length === 0) {
    console.log('check-docs: OK');
    return;
  }
  for (const problem of problems) {
    console.error(`${problem.file}:${problem.line}  ${problem.message}`);
  }
  console.error(
    `\ncheck-docs: ${problems.length} problem(s). Rules: docs/README.md → "Writing docs".`,
  );
  process.exit(1);
}

if (process.argv[1]?.endsWith('check-docs.ts')) main();
