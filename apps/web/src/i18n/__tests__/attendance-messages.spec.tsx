import { ATTENDANCE_TYPE_VALUES } from '@roviq/common-types';
import { describe, expect, it } from 'vitest';
import { getLocaleMessages } from '../messages';

describe('institute attendance translations', () => {
  for (const locale of ['en', 'hi']) {
    it(`provides a label for every attendance value in ${locale}`, () => {
      const labels = getLocaleMessages(locale).instituteSettings.config.attendanceOptions;
      expect(Object.keys(labels).sort()).toEqual([...ATTENDANCE_TYPE_VALUES].sort());
    });
  }
});
