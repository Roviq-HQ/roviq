import { describe, expect, it } from 'vitest';
import { quietHoursEnd } from '../quiet-hours';

describe('quietHoursEnd', () => {
  it.each([
    ['07:00 IST', '2026-11-23T01:30:00Z'],
    ['12:00 IST', '2026-11-23T06:30:00Z'],
    ['20:59 IST', '2026-11-23T15:29:00Z'],
  ])('should let a message go at %s', (_label, at) => {
    expect(quietHoursEnd('Asia/Kolkata', new Date(at))).toBeNull();
  });

  it('should hold a message at 21:00 until 07:00 the next morning', () => {
    expect(quietHoursEnd('Asia/Kolkata', new Date('2026-11-23T15:30:00Z'))).toEqual(
      new Date('2026-11-24T01:30:00Z'),
    );
  });

  it('should hold a message at 06:59 until 07:00 the same morning', () => {
    expect(quietHoursEnd('Asia/Kolkata', new Date('2026-11-23T01:29:00Z'))).toEqual(
      new Date('2026-11-23T01:30:00Z'),
    );
  });

  it("should read the hour in the institute's timezone, not in UTC", () => {
    // 18:00 UTC is 22:00 in Dubai and 13:00 in New York.
    const at = new Date('2026-11-23T18:00:00Z');
    expect(quietHoursEnd('Asia/Dubai', at)).toEqual(new Date('2026-11-24T03:00:00Z'));
    expect(quietHoursEnd('America/New_York', at)).toBeNull();
  });

  it('should throw on a timezone that does not exist', () => {
    expect(() => quietHoursEnd('Mars/Olympus', new Date())).toThrow();
  });
});
