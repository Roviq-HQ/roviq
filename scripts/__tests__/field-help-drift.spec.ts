import { describe, expect, it } from 'vitest';
import { readHelpFile } from '../check-field-help';
import { parseArgs } from '../help-ack';
import {
  ackTopics,
  checkDrift,
  formatDrift,
  type Lock,
  parseLock,
  serializeLock,
} from '../lib/field-help-drift';

const HELP = 'apps/web/src/help/demo/demo.help.ts';
const SOURCES = 'apps/web/src/help/demo/demo.help.sources.ts';

const HELP_TEXT = `import { defineFieldHelp } from '@roviq/ui';
export const demoHelp = defineFieldHelp('demo', {
  code: {
    title: { en: 'Code', hi: 'कोड' },
    hint: { en: 'Up to 8 letters.', hi: '8 अक्षर तक।' },
    body: { en: 'Printed on receipts.', hi: 'रसीद पर छपता है।' },
  },
  name: {
    title: { en: 'Name', hi: 'नाम' },
    body: { en: 'Shown on lists.', hi: 'सूची में दिखता है।' },
  },
});
`;

const SOURCES_TEXT = `import type { HelpSources } from '@roviq/ui';
import type { demoHelp } from './demo.help';
const SRC = 'src';
export const demoHelpSources = {
  code: [\`\${SRC}/limits.ts#limits.code\`, 'src/rules.sql'],
  name: ['src/limits.ts#limits.name', 'src/limits.ts#Service.save'],
} satisfies HelpSources<typeof demoHelp>;
`;

const LIMITS = `export const limits = {
  code: z.string().max(8),
  name: z.string().max(40),
};

export class Service {
  save(input: { code: string }) {
    return input.code;
  }
}

export function other() {
  return 1;
}
`;

const RULES = 'ALTER TABLE x ADD CONSTRAINT code_len CHECK (length(code) <= 8);\n';

const BASE_FILES: Record<string, string> = { 'src/limits.ts': LIMITS, 'src/rules.sql': RULES };

function topics(helpText = HELP_TEXT) {
  return readHelpFile(HELP, helpText, () => true).topics;
}

function reader(files: Record<string, string>) {
  return (path: string) => files[path] ?? null;
}

function initialLock(): Lock {
  const result = ackTopics({
    ids: topics().map((t) => t.id),
    reason: 'initial',
    topics: topics(),
    sourcesFiles: [{ file: SOURCES, text: SOURCES_TEXT }],
    lock: {},
    read: reader(BASE_FILES),
  });
  if ('error' in result) throw new Error(result.error);
  return result.lock;
}

function run(files: Record<string, string>, opts: { helpText?: string; sources?: string } = {}) {
  return checkDrift(
    topics(opts.helpText),
    [{ file: SOURCES, text: opts.sources ?? SOURCES_TEXT }],
    initialLock(),
    reader(files),
  );
}

describe('field help drift', () => {
  it('passes when nothing changed', () => {
    const { problems, drift } = run(BASE_FILES);
    expect(problems).toEqual([]);
    expect(drift).toEqual([]);
  });

  it('fails on a changed target and names only that topic', () => {
    const changed = LIMITS.replace('max(8)', 'max(10)');
    const { drift } = run({ ...BASE_FILES, 'src/limits.ts': changed });
    expect(drift.map((d) => d.topic.id)).toEqual(['demo.code']);
    expect(drift[0]?.changed).toEqual(['src/limits.ts#limits.code']);
    const out = formatDrift(drift);
    expect(out).toContain('hint: Up to 8 letters.');
    expect(out).toContain('body: Printed on receipts.');
    expect(out).not.toContain('demo.name');
  });

  it('still fails when only the copy was edited after the target changed', () => {
    const changed = LIMITS.replace('max(8)', 'max(10)');
    const helpText = HELP_TEXT.replace('Up to 8 letters.', 'Up to 10 letters.');
    const { drift } = run({ ...BASE_FILES, 'src/limits.ts': changed }, { helpText });
    expect(drift.map((d) => d.topic.id)).toEqual(['demo.code']);
  });

  it('passes after an acknowledgement with a reason', () => {
    const files = { ...BASE_FILES, 'src/limits.ts': LIMITS.replace('max(8)', 'max(10)') };
    const acked = ackTopics({
      ids: ['demo.code'],
      reason: 'limit raised to 10; hint updated',
      topics: topics(),
      sourcesFiles: [{ file: SOURCES, text: SOURCES_TEXT }],
      lock: initialLock(),
      read: reader(files),
    });
    if ('error' in acked) throw new Error(acked.error);
    expect(acked.lock['demo.code']?.reviewedReason).toBe('limit raised to 10; hint updated');
    const { drift } = checkDrift(
      topics(),
      [{ file: SOURCES, text: SOURCES_TEXT }],
      acked.lock,
      reader(files),
    );
    expect(drift).toEqual([]);
  });

  it.each(['', '   '])('refuses an acknowledgement without a reason (%j)', (reason) => {
    const result = ackTopics({
      ids: ['demo.code'],
      reason,
      topics: topics(),
      sourcesFiles: [{ file: SOURCES, text: SOURCES_TEXT }],
      lock: {},
      read: reader(BASE_FILES),
    });
    expect(result).toEqual({ error: expect.stringContaining('--reason') });
  });

  it('refuses an unknown topic', () => {
    const result = ackTopics({
      ids: ['demo.nope'],
      reason: 'x',
      topics: topics(),
      sourcesFiles: [{ file: SOURCES, text: SOURCES_TEXT }],
      lock: {},
      read: reader(BASE_FILES),
    });
    expect(result).toEqual({ error: 'unknown topic: demo.nope' });
  });

  it('ignores a reformat and comments in a target', () => {
    const reformatted = `// limits for the demo form
export const limits = {
  /** the code */
  code: z
    .string()
    .max(8), // eight
  name: z.string().max(40)
};

export class Service {
  save(input: { code: string },) {
    return input.code
  }
}

export function other() {
  return 1;
}
`;
    const { drift } = run({ ...BASE_FILES, 'src/limits.ts': reformatted });
    expect(drift).toEqual([]);
  });

  it('ignores an edit elsewhere in the same file', () => {
    const { drift } = run({
      ...BASE_FILES,
      'src/limits.ts': LIMITS.replace('return 1', 'return 2'),
    });
    expect(drift).toEqual([]);
  });

  it('collapses whitespace in a non-TypeScript target but sees a real change', () => {
    const spaced = RULES.replace('CHECK (', 'CHECK  (\n  ');
    expect(run({ ...BASE_FILES, 'src/rules.sql': spaced }).drift).toEqual([]);
    const changed = RULES.replace('<= 8', '<= 10');
    expect(run({ ...BASE_FILES, 'src/rules.sql': changed }).drift.map((d) => d.topic.id)).toEqual([
      'demo.code',
    ]);
  });

  it('fails when a target does not resolve', () => {
    const renamed = LIMITS.replace('save(input', 'store(input');
    const { problems } = run({ ...BASE_FILES, 'src/limits.ts': renamed });
    expect(problems.map((p) => p.message)).toEqual([
      'demo.name: src/limits.ts#Service.save: symbol not found',
    ]);
    const missing = run({ 'src/limits.ts': LIMITS });
    expect(missing.problems.map((p) => p.message)).toEqual([
      'demo.code: src/rules.sql: file not found',
    ]);
  });

  it('fails when a topic has no sources entry', () => {
    const sources = SOURCES_TEXT.replace(
      "  name: ['src/limits.ts#limits.name', 'src/limits.ts#Service.save'],\n",
      '',
    );
    const { problems } = run(BASE_FILES, { sources });
    expect(problems.map((p) => p.message)).toEqual([`demo.name: no sources entry in ${SOURCES}`]);
  });

  it('fails on a lock entry for a topic that no longer exists', () => {
    const lock = { ...initialLock(), 'demo.gone': { reviewedReason: 'x', targets: {} } };
    const { problems } = checkDrift(
      topics(),
      [{ file: SOURCES, text: SOURCES_TEXT }],
      lock,
      reader(BASE_FILES),
    );
    expect(problems.map((p) => p.message)).toEqual([
      'demo.gone: no such topic; `pnpm help:ack` on any topic removes it',
    ]);
  });

  it('writes the lock with sorted keys and reads it back', () => {
    const lock = initialLock();
    const text = serializeLock(lock);
    expect(Object.keys(JSON.parse(text))).toEqual(['demo.code', 'demo.name']);
    expect(parseLock(text)).toEqual(lock);
  });
});

describe('help:ack arguments', () => {
  it('reads topics and the reason', () => {
    expect(parseArgs(['demo.code', '--reason', 'checked'])).toEqual({
      ids: ['demo.code'],
      newOnly: false,
      reason: 'checked',
    });
    expect(parseArgs(['--new', '--reason=initial'])).toEqual({
      ids: [],
      newOnly: true,
      reason: 'initial',
    });
    expect(parseArgs(['demo.code']).reason).toBeNull();
  });
});
