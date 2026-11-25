/**
 * Gate — the migrations form one line: each snapshot's parent (`prevIds`) is the migration just
 * before it. Two branches that each generate a migration on the same parent pass their own gates,
 * but together drizzle-kit refuses them ("non-commutative migrations"). This finds that in a
 * second, before the e2e stack is built. Fix: generate the later branch's migrations again on
 * top of main's.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MIGRATIONS_DIR = join(process.cwd(), 'libs/database/migrations');

interface Snapshot {
  id: string;
  prevIds: string[];
}

export interface ChainBreak {
  migration: string;
  expectedParent: string;
  actualParents: string[];
}

/** Breaks in the chain, in folder order. The first migration may have any parent. */
export function findChainBreaks(dir: string): ChainBreak[] {
  const folders = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'snapshot.json')))
    .map((d) => d.name)
    .sort();
  const breaks: ChainBreak[] = [];
  let previous: { name: string; id: string } | null = null;
  for (const name of folders) {
    const snapshot = JSON.parse(readFileSync(join(dir, name, 'snapshot.json'), 'utf8')) as Snapshot;
    if (previous && !(snapshot.prevIds.length === 1 && snapshot.prevIds[0] === previous.id)) {
      breaks.push({
        migration: name,
        expectedParent: previous.name,
        actualParents: snapshot.prevIds,
      });
    }
    previous = { name, id: snapshot.id };
  }
  return breaks;
}

function main(): number {
  const breaks = findChainBreaks(MIGRATIONS_DIR);
  if (breaks.length === 0) {
    console.log('check:migration-chain — every migration follows the one before it.');
    return 0;
  }
  for (const b of breaks) {
    console.error(
      `✗ ${b.migration} was generated on another parent than ${b.expectedParent}` +
        ` (prevIds: ${b.actualParents.join(', ')}).`,
    );
  }
  console.error(
    'Two branches generated migrations on the same parent. Rebase on origin/main, delete this' +
      ' branch\'s migration folders and generate them again (docs/working-method.md → "Pushing").',
  );
  return 1;
}

if (process.argv[1]?.endsWith('check-migration-chain.ts')) {
  process.exit(main());
}
