import { describe, expect, it } from 'vitest';
import { isStopRequest } from '../stop-words';

const WORDS = [
  'stop',
  'stop all',
  'unsubscribe',
  'band',
  'band karo',
  'band karein',
  'बंद',
  'बंद करो',
  'बंद करें',
  'बन्द',
  'बन्द करो',
  'बन्द करें',
  'रोको',
  'रोकें',
  'स्टॉप',
];

describe('isStopRequest', () => {
  it.each(WORDS)('should take %s as a stop request', (word) => {
    expect(isStopRequest(word)).toBe(true);
  });

  it.each(WORDS)('should take %s in upper case with spaces and punctuation', (word) => {
    expect(isStopRequest(`  ${word.toUpperCase()}!! `)).toBe(true);
  });

  it.each([
    'STOP!',
    ' stop. ',
    'Stop',
    'sToP?',
    'बंद करें।',
    'Stop   All',
    'UNSUBSCRIBE.',
    '"stop"',
  ])('should take %j as a stop request', (text) => {
    expect(isStopRequest(text)).toBe(true);
  });

  it.each([
    'please do not stop',
    'stop sending fee reminders to my husband',
    'non-stop',
    'stopped',
    '',
    '   ',
    '!!!',
    'hello',
    'When is the next parent meeting?',
    'बंद करें क्या?  नहीं',
  ])('should not take %j as a stop request', (text) => {
    expect(isStopRequest(text)).toBe(false);
  });
});
