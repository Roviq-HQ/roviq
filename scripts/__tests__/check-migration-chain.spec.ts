import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findChainBreaks, MIGRATIONS_DIR } from '../check-migration-chain';

let dir: string;

function migration(name: string, id: string, prevIds: string[]): void {
  mkdirSync(join(dir, name));
  writeFileSync(join(dir, name, 'snapshot.json'), JSON.stringify({ id, prevIds }));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'migration-chain-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('findChainBreaks', () => {
  it('should accept a chain where each migration follows the one before it', () => {
    migration('001_base', 'a', ['root']);
    migration('002_next', 'b', ['a']);
    migration('003_last', 'c', ['b']);

    expect(findChainBreaks(dir)).toEqual([]);
  });

  it('should report two migrations generated on the same parent', () => {
    migration('001_base', 'a', ['root']);
    migration('002_from_main', 'b', ['a']);
    migration('003_from_branch', 'c', ['a']);

    expect(findChainBreaks(dir)).toEqual([
      { migration: '003_from_branch', expectedParent: '002_from_main', actualParents: ['a'] },
    ]);
  });

  it('should ignore folders without a snapshot', () => {
    migration('001_base', 'a', ['root']);
    mkdirSync(join(dir, '002_no_snapshot'));
    migration('003_next', 'b', ['a']);

    expect(findChainBreaks(dir)).toEqual([]);
  });

  it('should find no break in the repository chain', () => {
    expect(findChainBreaks(MIGRATIONS_DIR)).toEqual([]);
  });
});
