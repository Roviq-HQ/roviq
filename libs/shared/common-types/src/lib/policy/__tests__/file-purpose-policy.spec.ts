import { describe, expect, it } from 'vitest';
import { FILE_PURPOSE_VALUES } from '../../enums/file';
import {
  FILE_PURPOSE_POLICY,
  fileContentMatchesType,
  fileExtensionFor,
  isFileContentType,
} from '../file-purpose-policy';

const bytes = (...values: number[]) => Uint8Array.from(values);
const text = (value: string) => new TextEncoder().encode(value);

describe('FILE_PURPOSE_POLICY', () => {
  it('should define a policy for every file purpose', () => {
    expect(Object.keys(FILE_PURPOSE_POLICY).sort()).toEqual([...FILE_PURPOSE_VALUES].sort());
  });

  it.each(FILE_PURPOSE_VALUES)('should give %s a positive size limit and a type', (purpose) => {
    const policy = FILE_PURPOSE_POLICY[purpose];

    expect(policy.maxSizeBytes).toBeGreaterThan(0);
    expect(policy.allowedContentTypes.length).toBeGreaterThan(0);
  });

  it('should not let users upload the server-written import report', () => {
    expect(FILE_PURPOSE_POLICY.BULK_IMPORT_REPORT.uploadAbility).toBeNull();
  });
});

describe('isFileContentType', () => {
  it('should accept a known type and refuse an executable or an object key', () => {
    expect(isFileContentType('application/pdf')).toBe(true);
    expect(isFileContentType('application/x-msdownload')).toBe(false);
    expect(isFileContentType('toString')).toBe(false);
  });
});

describe('fileExtensionFor', () => {
  it('should map each type to its extension', () => {
    expect(fileExtensionFor('image/jpeg')).toBe('jpg');
    expect(fileExtensionFor('text/csv')).toBe('csv');
  });
});

describe('fileContentMatchesType', () => {
  it('should accept the real signature of each binary type', () => {
    expect(fileContentMatchesType(text('%PDF-1.7\n'), 'application/pdf')).toBe(true);
    expect(fileContentMatchesType(bytes(0xff, 0xd8, 0xff, 0xe0), 'image/jpeg')).toBe(true);
    expect(
      fileContentMatchesType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'image/png'),
    ).toBe(true);
    expect(fileContentMatchesType(text('RIFF\u0001\u0001\u0001\u0001WEBPVP8 '), 'image/webp')).toBe(
      true,
    );
  });

  it('should refuse an executable declared as a PDF', () => {
    expect(fileContentMatchesType(text('MZ\u0090\u0000'), 'application/pdf')).toBe(false);
  });

  it('should refuse a PNG declared as a JPEG', () => {
    expect(
      fileContentMatchesType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'image/jpeg'),
    ).toBe(false);
  });

  it('should refuse a RIFF file that is not WebP', () => {
    expect(fileContentMatchesType(text('RIFF\u0001\u0001\u0001\u0001WAVEfmt '), 'image/webp')).toBe(
      false,
    );
  });

  it('should accept a ZIP archive as XLSX and refuse anything else', () => {
    const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    expect(fileContentMatchesType(bytes(0x50, 0x4b, 0x03, 0x04, 0x14), xlsx)).toBe(true);
    expect(fileContentMatchesType(text('name,class\nAsha,5'), xlsx)).toBe(false);
    expect(fileContentMatchesType(bytes(), xlsx)).toBe(false);
    expect(fileExtensionFor(xlsx)).toBe('xlsx');
  });

  it('should accept text as CSV and refuse binary or empty content', () => {
    expect(fileContentMatchesType(text('name,class\nAsha,5'), 'text/csv')).toBe(true);
    expect(fileContentMatchesType(bytes(0x50, 0x4b, 0x03, 0x04, 0x00), 'text/csv')).toBe(false);
    expect(fileContentMatchesType(bytes(), 'text/csv')).toBe(false);
  });
});
