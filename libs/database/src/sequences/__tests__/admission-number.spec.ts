import { describe, expect, it } from 'vitest';
import type { AdmissionNumberConfig } from '../../schema/tenant/institute-configs';
import {
  admissionSeriesName,
  formatSequenceValue,
  parseSequenceValue,
  resolveAdmissionPrefix,
  resolveAdmissionYear,
} from '../admission-number';

const DEFAULT_CONFIG: AdmissionNumberConfig = {
  format: '{prefix}{year}/{value:04d}',
  year_format: 'YYYY',
  prefixes: { '-3': 'N-', '-2': 'L-', '-1': 'U-', '1': 'A-' },
  no_prefix_from_class: 2,
};

describe('resolveAdmissionPrefix', () => {
  it('Nursery (numeric_order = -3) → "N-"', () => {
    expect(resolveAdmissionPrefix(DEFAULT_CONFIG, -3)).toBe('N-');
  });

  it('LKG (numeric_order = -2) → "L-"', () => {
    expect(resolveAdmissionPrefix(DEFAULT_CONFIG, -2)).toBe('L-');
  });

  it('UKG (numeric_order = -1) → "U-"', () => {
    expect(resolveAdmissionPrefix(DEFAULT_CONFIG, -1)).toBe('U-');
  });

  it('Class 1 (numeric_order = 1) → "A-"', () => {
    expect(resolveAdmissionPrefix(DEFAULT_CONFIG, 1)).toBe('A-');
  });

  it('Class 2 (numeric_order = 2, >= no_prefix_from_class) → ""', () => {
    expect(resolveAdmissionPrefix(DEFAULT_CONFIG, 2)).toBe('');
  });

  it('Class 5 (numeric_order = 5, >= no_prefix_from_class) → ""', () => {
    expect(resolveAdmissionPrefix(DEFAULT_CONFIG, 5)).toBe('');
  });

  it('Class 10 (numeric_order = 10) → ""', () => {
    expect(resolveAdmissionPrefix(DEFAULT_CONFIG, 10)).toBe('');
  });

  it('numeric_order = 0 (no mapping) → ""', () => {
    expect(resolveAdmissionPrefix(DEFAULT_CONFIG, 0)).toBe('');
  });

  it('empty prefixes map → always ""', () => {
    const config: AdmissionNumberConfig = {
      ...DEFAULT_CONFIG,
      prefixes: {},
    };
    expect(resolveAdmissionPrefix(config, -3)).toBe('');
    expect(resolveAdmissionPrefix(config, 1)).toBe('');
  });
});

describe('resolveAdmissionYear', () => {
  it('YYYY format in June 2025 → "2025"', () => {
    const date = new Date('2025-06-15');
    expect(resolveAdmissionYear(DEFAULT_CONFIG, date)).toBe('2025');
  });

  it('YYYY format in January 2026 (before April) → "2025" (Indian academic year)', () => {
    const date = new Date('2026-01-15');
    expect(resolveAdmissionYear(DEFAULT_CONFIG, date)).toBe('2025');
  });

  it('YYYY format in April 2026 → "2026"', () => {
    const date = new Date('2026-04-01');
    expect(resolveAdmissionYear(DEFAULT_CONFIG, date)).toBe('2026');
  });

  it('YY-YY format in June 2025 → "25-26"', () => {
    const config: AdmissionNumberConfig = { ...DEFAULT_CONFIG, year_format: 'YY-YY' };
    const date = new Date('2025-06-15');
    expect(resolveAdmissionYear(config, date)).toBe('25-26');
  });

  it('YY-YY format in December 2099 → "99-00"', () => {
    const config: AdmissionNumberConfig = { ...DEFAULT_CONFIG, year_format: 'YY-YY' };
    const date = new Date('2099-12-01');
    expect(resolveAdmissionYear(config, date)).toBe('99-00');
  });
});

describe('admissionSeriesName', () => {
  it('gives each prefix its own series', () => {
    expect(admissionSeriesName('K-')).toBe('adm_no:K-');
    expect(admissionSeriesName('')).toBe('adm_no:');
    expect(admissionSeriesName('K-')).not.toBe(admissionSeriesName(''));
  });
});

describe('formatSequenceValue', () => {
  it('fills prefix, year and zero-padded value', () => {
    expect(
      formatSequenceValue('{prefix}{year}/{value:04d}', { prefix: 'K-', year: '2026', value: 7n }),
    ).toBe('K-2026/0007');
  });

  it('honours other pad widths and an unpadded {value}', () => {
    expect(formatSequenceValue('TC/{value:03d}', { prefix: '', year: '', value: 5n })).toBe(
      'TC/005',
    );
    expect(formatSequenceValue('{value}', { prefix: '', year: '', value: 42n })).toBe('42');
  });

  it('does not truncate values wider than the pad', () => {
    expect(formatSequenceValue('{value:04d}', { prefix: '', year: '', value: 123456n })).toBe(
      '123456',
    );
  });
});

describe('parseSequenceValue', () => {
  const FORMAT = '{prefix}{year}/{value:04d}';
  const N_2026 = { prefix: 'N-', year: '2026' };
  const PLAIN_2026 = { prefix: '', year: '2026' };

  it('should read serial 42 from N-2026/0042 in the N- series of 2026', () => {
    expect(parseSequenceValue(FORMAT, N_2026, 'N-2026/0042')).toBe(42n);
  });

  it('should read a serial wider than the padding, as formatSequenceValue prints it', () => {
    expect(parseSequenceValue(FORMAT, PLAIN_2026, '2026/123456')).toBe(123456n);
  });

  it('should refuse a number of another prefix', () => {
    expect(parseSequenceValue(FORMAT, N_2026, 'L-2026/0042')).toBeNull();
    expect(parseSequenceValue(FORMAT, PLAIN_2026, 'N-2026/0042')).toBeNull();
  });

  it('should refuse a number of another year', () => {
    expect(parseSequenceValue(FORMAT, N_2026, 'N-2025/0042')).toBeNull();
  });

  it('should refuse a number of another shape', () => {
    expect(parseSequenceValue(FORMAT, PLAIN_2026, 'OLD-17')).toBeNull();
    expect(parseSequenceValue(FORMAT, PLAIN_2026, '2026-0042')).toBeNull();
    expect(parseSequenceValue(FORMAT, PLAIN_2026, '2026/0042 ')).toBeNull();
  });

  it('should refuse a number the series would print differently (missing padding)', () => {
    expect(parseSequenceValue(FORMAT, PLAIN_2026, '2026/42')).toBeNull();
  });

  it('should refuse serial zero, which the series never issues', () => {
    expect(parseSequenceValue(FORMAT, PLAIN_2026, '2026/0000')).toBeNull();
  });

  it('should treat regex characters in the prefix and the template as plain text', () => {
    expect(parseSequenceValue('{prefix}{value:03d}', { prefix: 'A.', year: '' }, 'A.007')).toBe(7n);
    expect(
      parseSequenceValue('{prefix}{value:03d}', { prefix: 'A.', year: '' }, 'AX007'),
    ).toBeNull();
    expect(parseSequenceValue('ADM({year})-{value}', PLAIN_2026, 'ADM(2026)-9')).toBe(9n);
  });

  it('should read an unpadded {value} and a YY-YY year', () => {
    expect(parseSequenceValue('{year}/{value}', { prefix: '', year: '25-26' }, '25-26/17')).toBe(
      17n,
    );
  });

  it('should return null for a template with no value placeholder', () => {
    expect(parseSequenceValue('{prefix}{year}', N_2026, 'N-2026')).toBeNull();
  });

  it('should read back every number formatSequenceValue prints', () => {
    for (const format of [FORMAT, '{prefix}{value:04d}', '{year}{value:06d}', 'S-{value}']) {
      for (const value of [1n, 9n, 10n, 999n, 1000n, 10_000n, 123_456_789n]) {
        const printed = formatSequenceValue(format, { ...N_2026, value });
        expect(parseSequenceValue(format, N_2026, printed)).toBe(value);
      }
    }
  });
});
