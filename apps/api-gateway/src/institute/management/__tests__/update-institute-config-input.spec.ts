import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { UpdateInstituteConfigInput } from '../dto/update-institute-config.input';

async function errorsFor(input: Record<string, unknown>) {
  const errors = await validate(plainToInstance(UpdateInstituteConfigInput, input));
  return errors.map((error) => error.property);
}

describe('UpdateInstituteConfigInput times', () => {
  it('accepts the HH:mm:ss the config query returns, and HH:mm', async () => {
    expect(await errorsFor({ openingTime: '07:30:00', closingTime: '14:00:00' })).toEqual([]);
    expect(await errorsFor({ openingTime: '07:30', closingTime: '14:00' })).toEqual([]);
  });

  it('refuses a time that is not HH:mm or HH:mm:ss', async () => {
    expect(await errorsFor({ openingTime: '7:30', closingTime: '14:00:0' })).toEqual([
      'openingTime',
      'closingTime',
    ]);
  });
});
