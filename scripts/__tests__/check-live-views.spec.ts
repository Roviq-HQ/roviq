import { describe, expect, it } from 'vitest';
import { findBaseTableReads } from '../check-live-views';

const TABLES = ['studentGuardianLinks', 'phoneNumbers'];

describe('findBaseTableReads', () => {
  it('should flag a single-line join on a base table', () => {
    const text = 'tx.select().from(a).leftJoin(phoneNumbers, eq(a.id, b.id));';

    expect(findBaseTableReads(text, TABLES)).toEqual([{ line: 1, text, table: 'phoneNumbers' }]);
  });

  it('should flag a join wrapped so the table sits on the next line', () => {
    const text = [
      'tx.select()',
      '  .leftJoin(',
      '    studentGuardianLinks,',
      '    and(x, y),',
      '  )',
    ].join('\n');

    expect(findBaseTableReads(text, TABLES)).toEqual([
      { line: 3, text: 'studentGuardianLinks,', table: 'studentGuardianLinks' },
    ]);
  });

  it('should not flag the *Live view', () => {
    const text = ['.leftJoin(', '  studentGuardianLinksLive,', '  eq(a, b),', ')'].join('\n');

    expect(findBaseTableReads(text, TABLES)).toEqual([]);
  });

  it('should honour allow-base-read on either line of a wrapped join', () => {
    const onTable = ['.from(', '  phoneNumbers, // allow-base-read: trash list', ')'].join('\n');
    const onCall = ['.from( // allow-base-read: trash list', '  phoneNumbers,', ')'].join('\n');

    expect(findBaseTableReads(onTable, TABLES)).toEqual([]);
    expect(findBaseTableReads(onCall, TABLES)).toEqual([]);
  });

  it('should not flag writes against the base table', () => {
    const text = 'tx.insert(phoneNumbers).values(row); tx.update(studentGuardianLinks).set(v);';

    expect(findBaseTableReads(text, TABLES)).toEqual([]);
  });
});
