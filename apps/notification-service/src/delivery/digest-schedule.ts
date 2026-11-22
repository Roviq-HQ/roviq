import { Cron } from 'croner';

/** Next time `cron` fires after `now`, read in the institute's timezone. Throws on a bad pattern. */
export function nextDigestRun(cron: string, timezone: string, now: Date): Date {
  const next = new Cron(cron, { timezone }).nextRun(now);
  if (!next) throw new Error(`Digest cron "${cron}" never fires`);
  return next;
}

/**
 * The institute's own cron when it parses, else the type's default. A bad stored pattern must
 * not stop the message: the event would be redelivered until it reached the DLQ.
 */
export function nextDigestRunOrDefault(
  cron: string,
  defaultCron: string,
  timezone: string,
  now: Date,
): { runAt: Date; usedDefault: boolean } {
  try {
    return { runAt: nextDigestRun(cron, timezone, now), usedDefault: false };
  } catch {
    return { runAt: nextDigestRun(defaultCron, timezone, now), usedDefault: true };
  }
}
