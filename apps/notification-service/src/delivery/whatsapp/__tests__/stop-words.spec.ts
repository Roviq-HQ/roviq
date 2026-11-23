import { describe, expect, it } from 'vitest';
import { intentOf, isStartRequest, isStopRequest } from '../stop-words';

const STOP_WORDS = [
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

const START_WORDS = [
  'start',
  'unstop',
  'resume',
  'subscribe',
  'shuru',
  'shuru karo',
  'shuru karein',
  'chalu',
  'chalu karo',
  'शुरू',
  'शुरू करो',
  'शुरू करें',
  'चालू',
  'चालू करो',
  'चालू करें',
  'स्टार्ट',
];

const NEITHER = [
  'please do not stop',
  'stop sending fee reminders to my husband',
  'please start sending the fee alerts',
  'start again tomorrow',
  'non-stop',
  'stopped',
  'started',
  'restart',
  '',
  '   ',
  '!!!',
  'hello',
  'yes',
  'When is the next parent meeting?',
  'बंद करें क्या?  नहीं',
];

describe('isStopRequest', () => {
  it.each(STOP_WORDS)('should take %s as a stop request', (word) => {
    expect(isStopRequest(word)).toBe(true);
  });

  it.each(STOP_WORDS)('should take %s in upper case with spaces and punctuation', (word) => {
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

  it.each([...NEITHER, ...START_WORDS])('should not take %j as a stop request', (text) => {
    expect(isStopRequest(text)).toBe(false);
  });
});

describe('isStartRequest', () => {
  it.each(START_WORDS)('should take %s as a start request', (word) => {
    expect(isStartRequest(word)).toBe(true);
  });

  it.each(START_WORDS)('should take %s in upper case with spaces and punctuation', (word) => {
    expect(isStartRequest(`  ${word.toUpperCase()}!! `)).toBe(true);
  });

  it.each([
    'START!',
    ' start. ',
    'Start',
    'sTaRt?',
    'शुरू करें।',
    'Chalu   Karo',
    '"resume"',
  ])('should take %j as a start request', (text) => {
    expect(isStartRequest(text)).toBe(true);
  });

  it.each([...NEITHER, ...STOP_WORDS])('should not take %j as a start request', (text) => {
    expect(isStartRequest(text)).toBe(false);
  });
});

describe('intentOf', () => {
  it.each(['STOP', ' बंद करें। ', 'Unsubscribe!'])('should read %j as stop', (text) => {
    expect(intentOf(text)).toBe('stop');
  });

  it.each(['START', ' शुरू करें। ', 'Resume!'])('should read %j as start', (text) => {
    expect(intentOf(text)).toBe('start');
  });

  it.each(NEITHER)('should read %j as other', (text) => {
    expect(intentOf(text)).toBe('other');
  });

  it('should read the stop words and the start words apart', () => {
    expect(STOP_WORDS.map(intentOf)).toEqual(STOP_WORDS.map(() => 'stop'));
    expect(START_WORDS.map(intentOf)).toEqual(START_WORDS.map(() => 'start'));
  });
});
