import { describe, expect, it } from 'vitest';
import { checkDocs, checkFile, proseLines, unlistedDocs } from '../check-docs';

const exists =
  (...paths: string[]) =>
  (path: string): boolean =>
    paths.includes(path);

describe('checkFile', () => {
  it('accepts a relative link that resolves from the file', () => {
    const text = 'See [auth](../auth.md#jwt) and [site](https://example.com).';
    expect(checkFile('docs/guides/forms.md', text, exists('docs/auth.md'))).toEqual([]);
  });

  it('reports a link whose target is missing, with its line', () => {
    const text = 'first line\nSee [gone](plans/old.md).';
    expect(checkFile('docs/frontend.md', text, exists())).toEqual([
      { file: 'docs/frontend.md', line: 2, message: 'link target not found: plans/old.md' },
    ]);
  });

  it('resolves an angle-bracket link with parentheses and brackets in the path', () => {
    const target = 'apps/web/src/app/[locale]/institute/(dashboard)/page.tsx';
    const text = `[[id]/page.tsx](<../../${target}>)`;
    expect(checkFile('docs/features/students.md', text, exists(target))).toEqual([]);
    expect(checkFile('docs/features/students.md', text, exists())).toHaveLength(1);
  });

  it('reports a backticked repository path that does not exist', () => {
    const text = 'Seeds live in `scripts/seed.ts` and `scripts/seed-demo.ts:12`.';
    expect(checkFile('docs/a.md', text, exists('scripts/seed-demo.ts'))).toEqual([
      { file: 'docs/a.md', line: 1, message: 'path not found: scripts/seed.ts' },
    ]);
  });

  it('accepts a directory path with a trailing slash', () => {
    expect(checkFile('docs/a.md', 'In `libs/database/`.', exists('libs/database'))).toEqual([]);
  });

  it('skips patterns, placeholders and fenced code', () => {
    const text = [
      '`apps/web/**`, `docs/<name>.md`, `libs/{a,b}/src`, `[text](missing.md)`',
      '```bash',
      'cat `docs/missing.md` [x](missing.md)',
      '```',
    ].join('\n');
    expect(checkFile('docs/a.md', text, exists())).toEqual([]);
  });
});

describe('proseLines', () => {
  it('keeps line numbers while blanking fenced blocks', () => {
    expect(proseLines('a\n```\nb\n```\nc')).toEqual(['a', '', '', '', 'c']);
  });
});

describe('unlistedDocs', () => {
  it('returns the docs the index does not link to', () => {
    const files = ['docs/README.md', 'docs/auth.md', 'docs/guides/forms.md', 'README.md'];
    const index = '- [Auth](auth.md)';
    expect(unlistedDocs(files, index)).toEqual(['docs/guides/forms.md']);
  });
});

describe('checkDocs', () => {
  const read = (texts: Record<string, string>) => (file: string) => texts[file] ?? '';

  it('passes a consistent tree', () => {
    const texts = {
      'docs/README.md': '- [Auth](auth.md)\n- [Log](changelogs/log.md)',
      'docs/auth.md': 'Guards are in `libs/backend/auth/`.',
      'docs/changelogs/log.md': 'Old entry mentions `scripts/seed.ts`.',
      'libs/backend/auth/index.ts': '',
    };
    expect(checkDocs(Object.keys(texts), read(texts))).toEqual([]);
  });

  it('checks Markdown outside docs/ and skips vendored tooling', () => {
    const texts = {
      'docs/README.md': '',
      'CLAUDE.md': 'Read `docs/gone.md`.',
      '.github/skills/x/SKILL.md': 'Read `docs/gone.md`.',
    };
    expect(checkDocs(Object.keys(texts), read(texts))).toEqual([
      { file: 'CLAUDE.md', line: 1, message: 'path not found: docs/gone.md' },
    ]);
  });

  it('reports a doc missing from the index, and a missing index', () => {
    const texts = { 'docs/README.md': '', 'docs/auth.md': '' };
    expect(checkDocs(Object.keys(texts), read(texts))).toEqual([
      { file: 'docs/auth.md', line: 1, message: 'not linked from docs/README.md' },
    ]);
    expect(checkDocs(['docs/auth.md'], read(texts))).toEqual([
      { file: 'docs/README.md', line: 1, message: 'the documentation index is missing' },
    ]);
  });
});
