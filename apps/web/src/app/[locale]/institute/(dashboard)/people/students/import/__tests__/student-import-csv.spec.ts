import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import {
  canSkipColumn,
  mappingProblems,
  readCsvHeaders,
  sampleCsv,
  suggestMapping,
  toFieldMapping,
} from '../student-import-csv';

const csv = (text: string) => new Blob([text], { type: 'text/csv' });

describe('readCsvHeaders', () => {
  it('should return the trimmed header row and ignore the data rows', async () => {
    const result = await readCsvHeaders(csv(' Name ,DOB,"Gender, M/F"\nRiya,12/05/2014,female\n'));

    expect(result).toEqual({ headers: ['Name', 'DOB', 'Gender, M/F'], problem: null });
  });

  it('should drop the byte order mark Excel writes before the first header', async () => {
    const result = await readCsvHeaders(csv('﻿first_name,gender\n'));

    expect(result).toEqual({ headers: ['first_name', 'gender'], problem: null });
  });

  it('should report a file without a header row', async () => {
    expect(await readCsvHeaders(csv(''))).toEqual({ headers: [], problem: 'EMPTY' });
    expect(await readCsvHeaders(csv(' , \n'))).toEqual({ headers: [], problem: 'EMPTY' });
  });

  it('should report two columns with the same name', async () => {
    const result = await readCsvHeaders(csv('Name,DOB,Name\n'));

    expect(result).toEqual({ headers: ['Name', 'DOB', 'Name'], problem: 'DUPLICATE_HEADERS' });
  });
});

describe('suggestMapping', () => {
  it('should match headers that name a field and leave the rest out', () => {
    expect(suggestMapping(['First Name', 'date_of_birth', 'Gender', 'Student Name'])).toEqual({
      'First Name': 'first_name',
      date_of_birth: 'date_of_birth',
      Gender: 'gender',
      'Student Name': null,
    });
  });
});

describe('canSkipColumn', () => {
  it('should not let a column named like a field be left out, since the import reads it anyway', () => {
    expect(canSkipColumn('Phone')).toBe(false);
    expect(canSkipColumn('Mobile')).toBe(true);
  });
});

describe('mappingProblems', () => {
  it('should list required fields no column fills', () => {
    expect(mappingProblems({ Name: 'first_name', Mobile: 'phone', Notes: null })).toEqual({
      missing: ['date_of_birth', 'gender'],
      duplicates: [],
    });
  });

  it('should list fields filled by more than one column', () => {
    expect(
      mappingProblems({
        Name: 'first_name',
        'Full name': 'first_name',
        DOB: 'date_of_birth',
        Sex: 'gender',
      }),
    ).toEqual({ missing: [], duplicates: ['first_name'] });
  });
});

describe('toFieldMapping', () => {
  it('should keep only the columns that are imported', () => {
    expect(toFieldMapping({ Name: 'first_name', DOB: 'date_of_birth', Notes: null })).toEqual({
      Name: 'first_name',
      DOB: 'date_of_birth',
    });
  });
});

describe('sampleCsv', () => {
  it('should be a file whose headers need no mapping and whose rows pass the import rules', () => {
    const { data, errors } = Papa.parse<Record<string, string>>(sampleCsv(), {
      header: true,
      skipEmptyLines: true,
    });
    const headers = Object.keys(data[0] ?? {});

    expect(errors).toEqual([]);
    expect(mappingProblems(suggestMapping(headers))).toEqual({ missing: [], duplicates: [] });
    expect(data.map((row) => [row.first_name, row.date_of_birth, row.gender])).toEqual([
      ['Aarav', '15/08/2014', 'male'],
      ['Diya', '2013-02-03', 'female'],
    ]);
  });
});
