import { Injectable } from '@nestjs/common';
import {
  BusinessException,
  type DaySession,
  ErrorCode,
  type PeriodKind,
} from '@roviq/common-types';

/** A lunch/recess break inserted after a given regular period. */
export interface LunchInput {
  name: string;
  /** Insert the break immediately after this 1-based regular period. */
  afterPeriod: number;
  durationMins: number;
}

/** A block of morning (prepended) or evening (appended) extra periods. */
export interface ExtraClassInput {
  session: Extract<DaySession, 'MORNING' | 'EVENING'>;
  startTime: string;
  durationMins: number;
  count: number;
}

export interface GeneratePeriodsInput {
  /** First regular period start, "HH:mm" or "HH:mm:ss". */
  dayStartTime: string;
  periodDurationMins: number;
  periodsCount: number;
  lunch: LunchInput[];
  extraClass: ExtraClassInput[];
}

export interface GeneratedPeriod {
  kind: PeriodKind;
  label: string;
  sequence: number;
  /** "HH:mm:ss" */
  startTime: string;
  /** "HH:mm:ss" */
  endTime: string;
  session: DaySession;
}

function toMinutes(time: string): number {
  const parts = time.split(':');
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    throw new BusinessException(ErrorCode.TIMETABLE_INVALID_CONFIG, `Invalid time "${time}"`);
  }
  return hours * 60 + minutes;
}

function toTimeString(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:00`;
}

/**
 * Pure builder for a timetable's period grid. Takes the high-level shape
 * (start time, duration, period count, lunch breaks, extra-class blocks) and
 * produces the ordered list of PERIOD / BREAK / EXTRA rows with computed times.
 *
 * Order: morning extras → main day (regular periods interleaved with breaks)
 * → evening extras. Sequence numbers are assigned across the whole ordered list
 * so the grid renders top-to-bottom. All time math is minutes-since-midnight.
 */
@Injectable()
export class TimetableGenerationService {
  generatePeriods(input: GeneratePeriodsInput): GeneratedPeriod[] {
    this.validate(input);

    const morning = this.buildExtras(
      input.extraClass.filter((e) => e.session === 'MORNING'),
      'MORNING',
    );
    const main = this.buildMain(input);
    const evening = this.buildExtras(
      input.extraClass.filter((e) => e.session === 'EVENING'),
      'EVENING',
    );

    return [...morning, ...main, ...evening].map((p, index) => ({ ...p, sequence: index + 1 }));
  }

  private validate(input: GeneratePeriodsInput): void {
    if (input.periodsCount < 1) {
      throw new BusinessException(
        ErrorCode.TIMETABLE_INVALID_CONFIG,
        'A timetable must have at least one period.',
      );
    }
    if (input.periodDurationMins <= 0) {
      throw new BusinessException(
        ErrorCode.TIMETABLE_INVALID_CONFIG,
        'Period duration must be a positive number of minutes.',
      );
    }
    const seenLunchPositions = new Set<number>();
    for (const lunch of input.lunch) {
      if (lunch.afterPeriod < 1 || lunch.afterPeriod > input.periodsCount) {
        throw new BusinessException(
          ErrorCode.TIMETABLE_INVALID_CONFIG,
          `Lunch "${lunch.name}" position ${lunch.afterPeriod} is out of range (1–${input.periodsCount}).`,
        );
      }
      if (seenLunchPositions.has(lunch.afterPeriod)) {
        throw new BusinessException(
          ErrorCode.TIMETABLE_INVALID_CONFIG,
          `Two breaks are configured after period ${lunch.afterPeriod}.`,
        );
      }
      seenLunchPositions.add(lunch.afterPeriod);
      if (lunch.durationMins <= 0) {
        throw new BusinessException(
          ErrorCode.TIMETABLE_INVALID_CONFIG,
          `Break "${lunch.name}" duration must be positive.`,
        );
      }
    }
    for (const extra of input.extraClass) {
      if (extra.count < 1 || extra.durationMins <= 0) {
        throw new BusinessException(
          ErrorCode.TIMETABLE_INVALID_CONFIG,
          'Extra-class blocks need a positive count and duration.',
        );
      }
    }
  }

  /** Regular periods 1..N with lunches interleaved after their configured period. */
  private buildMain(input: GeneratePeriodsInput): Omit<GeneratedPeriod, 'sequence'>[] {
    const lunchByPeriod = new Map(input.lunch.map((l) => [l.afterPeriod, l]));
    const rows: Omit<GeneratedPeriod, 'sequence'>[] = [];
    let cursor = toMinutes(input.dayStartTime);

    for (let period = 1; period <= input.periodsCount; period++) {
      const end = cursor + input.periodDurationMins;
      rows.push({
        kind: 'PERIOD',
        label: String(period),
        startTime: toTimeString(cursor),
        endTime: toTimeString(end),
        session: 'MAIN',
      });
      cursor = end;

      const lunch = lunchByPeriod.get(period);
      if (lunch) {
        const lunchEnd = cursor + lunch.durationMins;
        rows.push({
          kind: 'BREAK',
          label: lunch.name,
          startTime: toTimeString(cursor),
          endTime: toTimeString(lunchEnd),
          session: 'MAIN',
        });
        cursor = lunchEnd;
      }
    }
    return rows;
  }

  /** Extra-class blocks for one session, labels namespaced by session to avoid collisions. */
  private buildExtras(
    blocks: ExtraClassInput[],
    session: 'MORNING' | 'EVENING',
  ): Omit<GeneratedPeriod, 'sequence'>[] {
    const prefix = session === 'MORNING' ? 'Morning Extra' : 'Evening Extra';
    const rows: Omit<GeneratedPeriod, 'sequence'>[] = [];
    let counter = 0;
    for (const block of blocks) {
      let cursor = toMinutes(block.startTime);
      for (let i = 0; i < block.count; i++) {
        counter += 1;
        const end = cursor + block.durationMins;
        rows.push({
          kind: 'EXTRA',
          label: `${prefix} ${counter}`,
          startTime: toTimeString(cursor),
          endTime: toTimeString(end),
          session,
        });
        cursor = end;
      }
    }
    return rows;
  }
}
