import { describe, expect, it } from 'vitest';
import { nextDigestRun, nextDigestRunOrDefault } from '../digest-schedule';

describe('nextDigestRun', () => {
  it('should fire at 18:00 in the institute timezone, not in UTC', () => {
    const now = new Date('2026-04-10T05:00:00.000Z'); // 10:30 in Kolkata

    expect(nextDigestRun('0 18 * * *', 'Asia/Kolkata', now).toISOString()).toBe(
      '2026-04-10T12:30:00.000Z',
    );
  });

  it('should move to the next day once today’s run has passed', () => {
    const now = new Date('2026-04-10T13:00:00.000Z'); // 18:30 in Kolkata

    expect(nextDigestRun('0 18 * * *', 'Asia/Kolkata', now).toISOString()).toBe(
      '2026-04-11T12:30:00.000Z',
    );
  });

  it('should follow the institute timezone for an institute outside India', () => {
    const now = new Date('2026-04-10T05:00:00.000Z'); // 09:00 in Dubai

    expect(nextDigestRun('0 18 * * *', 'Asia/Dubai', now).toISOString()).toBe(
      '2026-04-10T14:00:00.000Z',
    );
  });

  it('should fire the weekly fee digest on the next Monday 09:00', () => {
    const now = new Date('2026-04-10T05:00:00.000Z'); // Friday

    expect(nextDigestRun('0 9 * * 1', 'Asia/Kolkata', now).toISOString()).toBe(
      '2026-04-13T03:30:00.000Z',
    );
  });
});

describe('nextDigestRunOrDefault', () => {
  const now = new Date('2026-04-10T05:00:00.000Z');

  it('should use the institute cron when it parses', () => {
    expect(nextDigestRunOrDefault('0 20 * * *', '0 18 * * *', 'Asia/Kolkata', now)).toEqual({
      runAt: new Date('2026-04-10T14:30:00.000Z'),
      usedDefault: false,
    });
  });

  it('should fall back to the type default when the institute cron is invalid', () => {
    expect(nextDigestRunOrDefault('every evening', '0 18 * * *', 'Asia/Kolkata', now)).toEqual({
      runAt: new Date('2026-04-10T12:30:00.000Z'),
      usedDefault: true,
    });
  });
});
