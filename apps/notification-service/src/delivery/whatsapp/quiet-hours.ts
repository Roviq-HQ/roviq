import { Cron } from 'croner';

/** Non-critical WhatsApp messages wait from 21:00 to 07:00 in the institute's timezone. */
export const QUIET_HOURS = { startHour: 21, endHour: 7 } as const;

const END_OF_QUIET = `0 ${QUIET_HOURS.endHour} * * *`;

function hourIn(timezone: string, at: Date): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(at);
  return Number(hour);
}

/** When quiet hours end if `now` is inside them, else null. Throws on an unknown timezone. */
export function quietHoursEnd(timezone: string, now: Date): Date | null {
  const hour = hourIn(timezone, now);
  if (hour < QUIET_HOURS.startHour && hour >= QUIET_HOURS.endHour) return null;
  const end = new Cron(END_OF_QUIET, { timezone }).nextRun(now);
  if (!end) throw new Error(`No end of quiet hours in ${timezone}`);
  return end;
}
