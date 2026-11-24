import { describe, expect, it } from 'vitest';
import { buildCsv } from '../csv';

describe('buildCsv', () => {
  it('quotes every field, doubles embedded quotes and starts with a BOM', () => {
    const csv = buildCsv(
      ['Name', 'Note'],
      [
        ['Aarav "AJ" Sharma', 'a,b'],
        ['सीता', 3],
      ],
    );

    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.slice(1).split('\n')).toEqual([
      '"Name","Note"',
      '"Aarav ""AJ"" Sharma","a,b"',
      '"सीता","3"',
    ]);
  });

  it('keeps a cell typed by a user from running as a formula', () => {
    const csv = buildCsv(
      ['Name', 'Balance'],
      [
        ['=HYPERLINK("http://x","y")', -5],
        ['+1', 2],
        ['-2+3', 2],
        ['@SUM(A1)', 2],
        ['\tx', 2],
      ],
    );

    expect(csv.slice(1).split('\n')).toEqual([
      '"Name","Balance"',
      `"'=HYPERLINK(""http://x"",""y"")","-5"`,
      `"'+1","2"`,
      `"'-2+3","2"`,
      `"'@SUM(A1)","2"`,
      `"'\tx","2"`,
    ]);
  });
});
