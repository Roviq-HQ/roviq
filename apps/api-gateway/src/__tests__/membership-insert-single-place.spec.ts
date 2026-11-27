import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../../..');
const SOURCE_DIRS = ['apps', 'ee/apps', 'libs/backend'];
const ONLY_PLACE = 'apps/api-gateway/src/auth/membership-lifecycle.ts';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const skipped = ['node_modules', 'dist', '.next', '__tests__', 'testing'];
      return skipped.includes(entry.name) ? [] : sourceFiles(path);
    }
    return /\.ts$/.test(entry.name) && !/\.spec\.ts$/.test(entry.name) ? [path] : [];
  });
}

describe('institute memberships are inserted in one place', () => {
  it('should find `.insert(memberships)` only in the membership lifecycle helper', () => {
    const offenders = SOURCE_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir)))
      .filter((file) => /\.insert\(\s*memberships\s*\)/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file));
    // A second insert would not bring back the membership of a person who returns.
    expect(offenders).toEqual([ONLY_PLACE]);
  });
});
