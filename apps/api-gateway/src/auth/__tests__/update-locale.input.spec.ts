import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { UpdateLocaleInput } from '../dto/update-locale.input';

describe('UpdateLocaleInput', () => {
  it.each(['en', 'hi', null, undefined])('should accept %s', async (locale) => {
    const input = new UpdateLocaleInput();
    input.locale = locale;
    expect(await validate(input)).toEqual([]);
  });
  it.each(['fr', 'HI', '', 'hi-IN'])('should reject unsupported locale %s', async (locale) => {
    const input = new UpdateLocaleInput();
    input.locale = locale;
    const errors = await validate(input);
    expect(errors.map((error) => error.property)).toEqual(['locale']);
  });
});
