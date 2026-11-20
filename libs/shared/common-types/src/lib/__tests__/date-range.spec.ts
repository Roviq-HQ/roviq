import { describe, expect, it } from 'vitest';
import { isCalendarDate } from '../date-range';

describe('isCalendarDate', () => {
  it.each(['2030-01-01', '2028-02-29', '2030-12-31'])('should accept %s', (value) => {
    expect(isCalendarDate(value)).toBe(true);
  });

  it.each([
    '2030-02-30',
    '2029-02-29',
    '2030-13-01',
    '2030-00-10',
    '2030-04-31',
    'garbage',
    '2030-1-01',
    '2030-01-01T00:00:00Z',
    '',
  ])('should refuse %j', (value) => {
    expect(isCalendarDate(value)).toBe(false);
  });
});
