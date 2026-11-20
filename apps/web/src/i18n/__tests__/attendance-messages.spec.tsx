import { ATTENDANCE_TYPE_VALUES } from '@roviq/common-types';
import { describe, expect, it } from 'vitest';
import en from '../../../messages/en/instituteSettings.json';
import hi from '../../../messages/hi/instituteSettings.json';

describe('institute attendance translations', () => {
  for (const [locale, messages] of Object.entries({ en, hi })) {
    it(`provides a label for every attendance value in ${locale}`, () => {
      const labels = messages.config.attendanceOptions;
      expect(Object.keys(labels).sort()).toEqual([...ATTENDANCE_TYPE_VALUES].sort());
    });
  }
});
