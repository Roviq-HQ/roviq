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
});
