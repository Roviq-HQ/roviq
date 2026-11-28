import { describe, expect, it } from 'vitest';
import {
  codeOnly,
  findLogCalls,
  findLogHits,
  findLogProblems,
  interpolations,
  LOG_MESSAGE_ALLOWLIST,
  namesPersonalValue,
  readsAnError,
} from '../check-log-messages';

const SERVICE = 'apps/api-gateway/src/institute/thing/thing.service.ts';
const rules = (source: string) => findLogProblems(SERVICE, source).map((hit) => hit.rule);

describe('check-log-messages', () => {
  it('should pass the repository as it is', () => {
    expect(findLogHits()).toEqual([]);
  });

  it('should give every allowlisted call a reason', () => {
    for (const reason of Object.values(LOG_MESSAGE_ALLOWLIST)) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  describe('a personal value in the message', () => {
    it.each([
      ['a first name', 'this.logger.log(`Created student "${row.firstName}"`);'],
      ['a phone number', 'this.logger.warn(`No account for ${input.phone}`);'],
      ['an e-mail address', 'logger.log(`Welcome sent to ${user.email}`);'],
      ['a username', 'this.logger.warn(`Sign-in failed for ${username}`);'],
      ['a password', 'this.logger.debug(`Temporary password ${tempPassword}`);'],
      ['a token', 'this.logger.debug(`Issued ${accessToken}`);'],
      ['a one-time code', 'this.logger.log(`Code for ${userId}: ${otp}`);'],
      ['text a user typed', 'this.logger.log(`Revoked, reason=${input.reason ?? "none"}`);'],
      ['the values of a query', 'this.logger.debug(`${query} -- ${JSON.stringify(params)}`);'],
    ])('should flag %s', (_what, source) => {
      expect(rules(source)).toEqual(['personal-value']);
    });

    it('should name the file, the line and the expression', () => {
      const source = '\n\nthis.logger.log(`Created ${row.firstName}`);';
      expect(findLogProblems(SERVICE, source)).toEqual([
        { rule: 'personal-value', file: SERVICE, line: 3, detail: 'row.firstName' },
      ]);
    });

    it.each([
      ['an id', 'this.logger.log(`Student created: ${studentProfileId}`);'],
      ['the id of a row found by e-mail', 'logger.log(`Found guardian ${existingByEmail[0].id}`);'],
      ['a count', 'this.logger.log(`Invalidated ${count} groups`);'],
      ['a name from the code', 'this.logger.log(`Stream "${stream.name}" ensured`);'],
      ['a field name', 'this.logger.error({ err }, `Audit failed for ${info.fieldName}`);'],
      ['a count of query values', 'this.logger.debug(`${query} -- ${params.length} value(s)`);'],
    ])('should accept %s', (_what, source) => {
      expect(rules(source)).toEqual([]);
    });

    it('should accept the word in the text of the message', () => {
      expect(rules("this.logger.warn('Sign-in failed: wrong password or username');")).toEqual([]);
    });
  });

  describe('an error in the message', () => {
    it.each([
      ['the error itself', 'this.logger.warn(`Failed to start for ${id}: ${err}`);'],
      ['its message', 'this.logger.error(`Could not scan ${id}: ${err.message}`);'],
      ['String(error)', 'this.logger.error(`PDF not rendered: ${String(error)}`);'],
      ['a cast', 'this.logger.warn(`Lookup failed: ${(err as Error).message}`);'],
      [
        'a conditional',
        'this.logger.error(`Stop failed: ${err instanceof Error ? err.message : String(err)}`);',
      ],
      ['an error under another name', 'this.logger.error(`DLQ publish failed: ${dlqErr}`);'],
    ])('should flag %s', (_what, source) => {
      expect(rules(source)).toEqual(['error-in-message']);
    });

    it.each([
      ['an error code', 'this.logger.warn(`Reply failed: ${err.code}`);'],
      ['an error type', "this.logger.warn(`Token request failed: ${err.name ?? 'error'}`);"],
      ['a result field', 'this.logger.warn(`Attempt failed: ${outcome.errorCode}`);'],
      ['a count of errors', 'this.logger.log(`Parsed with ${errors.length} errors`);'],
      ['a text field of a result', "this.logger.warn(`Check failed: ${result.error ?? 'x'}`);"],
    ])('should accept %s', (_what, source) => {
      expect(rules(source)).toEqual([]);
    });
  });

  describe('an error after the message', () => {
    it.each([
      ['the error', "this.logger.error('Sweep failed', err);"],
      [
        'its stack',
        'this.logger.error(`Export ${id} failed`, err instanceof Error ? err.stack : String(err));',
      ],
      ['its message', "this.logger.error('Suspend failed', (err as Error).message);"],
      ['the error alone', 'this.logger.error(error.message);'],
    ])('should flag %s', (_what, source) => {
      expect(rules(source)).toEqual(['error-as-argument']);
    });

    it.each([
      ['{ err }', "this.logger.error({ err }, 'Sweep failed');"],
      ['{ err: error } with an id', 'this.logger.error({ err: error }, `Export ${id} failed`);'],
      ['a message held in a variable', 'this.logger.error({ err }, message);'],
    ])('should accept %s', (_what, source) => {
      expect(rules(source)).toEqual([]);
    });
  });

  describe('console', () => {
    it('should flag a console call', () => {
      expect(rules("console.error('Failed to decrypt', err);")).toEqual(['console-call']);
    });

    it('should ignore one written inside a string', () => {
      const source = 'throw new Error("Generate with: node -e \\"console.log(1)\\"");';
      expect(rules(source)).toEqual([]);
    });
  });

  describe('reading the source', () => {
    it('should ignore an example in a comment', () => {
      expect(rules('// this.logger.log(`Created ${row.firstName}`)')).toEqual([]);
      expect(rules('/* logger.error("x", err) */')).toEqual([]);
    });

    it('should read a call written over several lines', () => {
      const source = [
        'this.logger.log(',
        '  `Guardian access revoked: guardian=${input.guardianProfileId}, ` +',
        '    `reason=${input.reason}`,',
        ');',
      ].join('\n');
      expect(rules(source)).toEqual(['personal-value']);
    });

    it('should not take Math.log or a method named log on another object for a logger', () => {
      expect(findLogCalls('const x = Math.log(phone); queue.info(email);')).toEqual([]);
    });

    it('should split arguments at top-level commas only', () => {
      const [call] = findLogCalls("this.logger.warn({ a: 1, b: [2, 3] }, `x ${f(1, 2)}`, 'c,d');");
      expect(call?.args).toEqual(['{ a: 1, b: [2, 3] }', '`x ${f(1, 2)}`', "'c,d'"]);
    });

    it('should blank strings, template text and comments and keep template holes', () => {
      expect(codeOnly("a('b') // c")).toBe('a(   )     ');
      expect(codeOnly('`x ${y} z`')).toBe('     y    ');
    });

    it('should list the holes of a template, also one with an object literal', () => {
      expect(interpolations('`a ${b} c ${JSON.stringify({ d })}`')).toEqual([
        'b',
        'JSON.stringify({ d })',
      ]);
    });

    it('should tell an error from its code', () => {
      expect(readsAnError('err')).toBe(true);
      expect(readsAnError('error.stack')).toBe(true);
      expect(readsAnError('err.code')).toBe(false);
      expect(readsAnError('event.field')).toBe(false);
    });

    it('should look at the last segment of a member chain only', () => {
      expect(namesPersonalValue('byPhone.id')).toBe(false);
      expect(namesPersonalValue('row.phone')).toBe(true);
      expect(namesPersonalValue('mask(row.phone)')).toBe(true);
    });
  });
});

describe('structured fields', () => {
  it('should refuse a field that is not in LOG_FIELDS, quoted or shorthand', () => {
    const hits = findLogProblems(
      'apps/x.ts',
      "this.logger.warn({ tenantId, 'made.up': 1, phoneOfParent, ...rest, nested: { a: 1 } }, 'Skipped');",
    );
    expect(hits.map((hit) => `${hit.rule} ${hit.detail}`)).toEqual([
      'unlisted-field made.up',
      'unlisted-field phoneOfParent',
      'unlisted-field nested',
    ]);
  });

  it('should accept listed fields', () => {
    expect(
      findLogProblems(
        'apps/x.ts',
        "this.logger.error({ err, userId, 'dlq.subject': s }, 'Failed');",
      ),
    ).toEqual([]);
  });
});
