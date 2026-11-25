// Records that a field help topic was reviewed against the code it describes (ROV-347).
//
//   pnpm help:ack <topic> [<topic> …] --reason "<what you checked>"
//
// Run it after `pnpm check:field-help` names a topic: read the topic, edit its copy (en and hi) if
// the behaviour changed, then acknowledge. It re-fingerprints that topic's targets into
// apps/web/src/help/field-help.lock.json with the reason, and drops lock entries of topics that no
// longer exist. `--new` acknowledges only topics that have no lock entry yet (a new help file); it
// never clears a topic already in the lock.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadFieldHelp, readRepoFile } from './check-field-help';
import { ackTopics, LOCK_FILE, parseLock, serializeLock } from './lib/field-help-drift';

export function parseArgs(argv: readonly string[]): {
  ids: string[];
  newOnly: boolean;
  reason: string | null;
} {
  const ids: string[] = [];
  let newOnly = false;
  let reason: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--new') newOnly = true;
    else if (arg === '--reason') {
      reason = argv[i + 1] ?? '';
      i++;
    } else if (arg?.startsWith('--reason=')) reason = arg.slice('--reason='.length);
    else if (arg) ids.push(arg);
  }
  return { ids, newOnly, reason };
}

function fail(message: string): never {
  console.error(`help:ack: ${message}`);
  console.error('Usage: pnpm help:ack <topic> [<topic> …] --reason "<what you checked>"');
  process.exit(1);
}

function main(): void {
  const { ids, newOnly, reason } = parseArgs(process.argv.slice(2));
  if (!reason?.trim()) fail('--reason "<what you checked>" is required');
  if (newOnly && ids.length > 0) fail('give topics or --new, not both');
  if (!newOnly && ids.length === 0) fail('name at least one topic');
  const root = process.cwd();
  const { topics, sourcesFiles } = loadFieldHelp(root);
  const lock = parseLock(readRepoFile(LOCK_FILE));
  const chosen = newOnly ? topics.map((topic) => topic.id).filter((id) => !(id in lock)) : ids;
  if (chosen.length === 0) fail('no topic without a lock entry');
  const result = ackTopics({
    ids: chosen,
    reason,
    topics,
    sourcesFiles,
    lock,
    read: readRepoFile,
  });
  if ('error' in result) fail(result.error);
  writeFileSync(resolve(root, LOCK_FILE), serializeLock(result.lock));
  console.log(`help:ack: ${chosen.length} topic(s) reviewed: ${reason}`);
  if (result.pruned.length > 0) console.log(`help:ack: removed ${result.pruned.join(', ')}`);
}

if (process.argv[1]?.endsWith('help-ack.ts')) main();
