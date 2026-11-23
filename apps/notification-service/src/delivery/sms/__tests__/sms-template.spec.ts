import assert from 'node:assert';
import { describe, expect, it } from 'vitest';
import {
  fitVariables,
  isGsm7,
  SMS_VARIABLE_MAX,
  SmsVariableError,
  smsSegments,
} from '../sms-template';

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected a throw');
}

describe('fitVariables', () => {
  it('should keep a value of exactly the limit', () => {
    const value = 'a'.repeat(SMS_VARIABLE_MAX);

    expect(fitVariables([value], [])).toEqual([value]);
  });

  it('should cut a value one over the limit to the limit, ending in ..', () => {
    const [fitted] = fitVariables(['b'.repeat(SMS_VARIABLE_MAX + 1)], []);

    expect(fitted).toBe(`${'b'.repeat(SMS_VARIABLE_MAX - 2)}..`);
    expect(fitted?.length).toBe(SMS_VARIABLE_MAX);
  });

  it('should turn line breaks and tabs into one space', () => {
    expect(fitVariables(['Sunrise\r\nPublic\t\tInstitute'], [])).toEqual([
      'Sunrise Public Institute',
    ]);
  });

  it('should refuse an exact value over the limit, naming its position', () => {
    const tooLong = 'p'.repeat(SMS_VARIABLE_MAX + 1);

    const err = thrownBy(() => fitVariables(['Sunrise', tooLong], [2]));

    assert(err instanceof SmsVariableError);
    expect(err.position).toBe(2);
    expect(err.message).toBe('SMS variable 2 must be exact and is longer than 30 characters');
  });

  it('should pass an exact value of exactly the limit', () => {
    const value = 'q'.repeat(SMS_VARIABLE_MAX);

    expect(fitVariables([value], [1])).toEqual([value]);
  });

  it('should cut a Devanagari value by characters and keep it within the limit', () => {
    const value = 'सनराइज़ पब्लिक सीनियर सेकेंडरी विद्यालय';
    const [fitted] = fitVariables([value], []);

    expect(fitted).toBe(`${[...value].slice(0, SMS_VARIABLE_MAX - 2).join('')}..`);
    expect([...(fitted ?? '')].length).toBe(SMS_VARIABLE_MAX);
  });

  it('should cut by characters, not UTF-16 units, for a character outside the basic plane', () => {
    const value = '𝐀'.repeat(SMS_VARIABLE_MAX);

    expect(value.length).toBe(SMS_VARIABLE_MAX * 2);
    expect(fitVariables([value], [1])).toEqual([value]);
  });
});

describe('isGsm7 and smsSegments', () => {
  it.each([
    [160, 1],
    [161, 2],
    [306, 2],
    [307, 3],
  ])('should count %i plain characters as %i parts', (length, parts) => {
    const text = 'a'.repeat(length);

    expect(isGsm7(text)).toBe(true);
    expect(smsSegments(text)).toBe(parts);
  });

  it.each(['{', '€'])('should count %s from the extension table as two', (char) => {
    expect(isGsm7(`${'a'.repeat(158)}${char}`)).toBe(true);
    expect(smsSegments(`${'a'.repeat(158)}${char}`)).toBe(1);
    expect(smsSegments(`${'a'.repeat(159)}${char}`)).toBe(2);
  });

  it.each([
    [70, 1],
    [71, 2],
    [134, 2],
    [135, 3],
  ])('should count %i characters with one Devanagari as %i parts', (length, parts) => {
    const text = `क${'a'.repeat(length - 1)}`;

    expect(isGsm7(text)).toBe(false);
    expect(smsSegments(text)).toBe(parts);
  });
});
