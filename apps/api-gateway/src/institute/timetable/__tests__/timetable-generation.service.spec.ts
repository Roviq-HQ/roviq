import { BusinessException } from '@roviq/common-types';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type GeneratePeriodsInput,
  TimetableGenerationService,
} from '../timetable-generation.service';

describe('TimetableGenerationService', () => {
  let service: TimetableGenerationService;

  beforeEach(() => {
    service = new TimetableGenerationService();
  });

  it('generates the full grid: morning extra, periods with a mid-day lunch, evening extras', () => {
    const input: GeneratePeriodsInput = {
      dayStartTime: '08:00',
      periodDurationMins: 45,
      periodsCount: 6,
      lunch: [{ name: 'Lunch', afterPeriod: 3, durationMins: 30 }],
      extraClass: [
        { session: 'MORNING', startTime: '07:15', durationMins: 30, count: 1 },
        { session: 'EVENING', startTime: '14:00', durationMins: 40, count: 2 },
      ],
    };

    const periods = service.generatePeriods(input);

    expect(
      periods.map((p) => ({
        kind: p.kind,
        label: p.label,
        sequence: p.sequence,
        startTime: p.startTime,
        endTime: p.endTime,
        session: p.session,
      })),
    ).toEqual([
      {
        kind: 'EXTRA',
        label: 'Morning Extra 1',
        sequence: 1,
        startTime: '07:15:00',
        endTime: '07:45:00',
        session: 'MORNING',
      },
      {
        kind: 'PERIOD',
        label: '1',
        sequence: 2,
        startTime: '08:00:00',
        endTime: '08:45:00',
        session: 'MAIN',
      },
      {
        kind: 'PERIOD',
        label: '2',
        sequence: 3,
        startTime: '08:45:00',
        endTime: '09:30:00',
        session: 'MAIN',
      },
      {
        kind: 'PERIOD',
        label: '3',
        sequence: 4,
        startTime: '09:30:00',
        endTime: '10:15:00',
        session: 'MAIN',
      },
      {
        kind: 'BREAK',
        label: 'Lunch',
        sequence: 5,
        startTime: '10:15:00',
        endTime: '10:45:00',
        session: 'MAIN',
      },
      {
        kind: 'PERIOD',
        label: '4',
        sequence: 6,
        startTime: '10:45:00',
        endTime: '11:30:00',
        session: 'MAIN',
      },
      {
        kind: 'PERIOD',
        label: '5',
        sequence: 7,
        startTime: '11:30:00',
        endTime: '12:15:00',
        session: 'MAIN',
      },
      {
        kind: 'PERIOD',
        label: '6',
        sequence: 8,
        startTime: '12:15:00',
        endTime: '13:00:00',
        session: 'MAIN',
      },
      {
        kind: 'EXTRA',
        label: 'Evening Extra 1',
        sequence: 9,
        startTime: '14:00:00',
        endTime: '14:40:00',
        session: 'EVENING',
      },
      {
        kind: 'EXTRA',
        label: 'Evening Extra 2',
        sequence: 10,
        startTime: '14:40:00',
        endTime: '15:20:00',
        session: 'EVENING',
      },
    ]);
  });

  it('handles a plain timetable with no lunch and no extras', () => {
    const periods = service.generatePeriods({
      dayStartTime: '09:00',
      periodDurationMins: 60,
      periodsCount: 2,
      lunch: [],
      extraClass: [],
    });

    expect(periods).toEqual([
      {
        kind: 'PERIOD',
        label: '1',
        sequence: 1,
        startTime: '09:00:00',
        endTime: '10:00:00',
        session: 'MAIN',
      },
      {
        kind: 'PERIOD',
        label: '2',
        sequence: 2,
        startTime: '10:00:00',
        endTime: '11:00:00',
        session: 'MAIN',
      },
    ]);
  });

  it('supports multiple lunch breaks at different positions', () => {
    const periods = service.generatePeriods({
      dayStartTime: '08:00',
      periodDurationMins: 40,
      periodsCount: 4,
      lunch: [
        { name: 'Short Break', afterPeriod: 2, durationMins: 15 },
        { name: 'Lunch', afterPeriod: 3, durationMins: 30 },
      ],
      extraClass: [],
    });

    expect(periods.map((p) => p.label)).toEqual(['1', '2', 'Short Break', '3', 'Lunch', '4']);
    const shortBreak = periods.find((p) => p.label === 'Short Break');
    expect(shortBreak?.startTime).toBe('09:20:00');
    expect(shortBreak?.endTime).toBe('09:35:00');
  });

  it('rejects a lunch positioned after a non-existent period', () => {
    expect(() =>
      service.generatePeriods({
        dayStartTime: '08:00',
        periodDurationMins: 45,
        periodsCount: 3,
        lunch: [{ name: 'Lunch', afterPeriod: 5, durationMins: 30 }],
        extraClass: [],
      }),
    ).toThrow(BusinessException);
  });

  it('rejects zero periods', () => {
    expect(() =>
      service.generatePeriods({
        dayStartTime: '08:00',
        periodDurationMins: 45,
        periodsCount: 0,
        lunch: [],
        extraClass: [],
      }),
    ).toThrow(BusinessException);
  });

  it('rejects two breaks after the same period', () => {
    expect(() =>
      service.generatePeriods({
        dayStartTime: '08:00',
        periodDurationMins: 45,
        periodsCount: 3,
        lunch: [
          { name: 'A', afterPeriod: 2, durationMins: 10 },
          { name: 'B', afterPeriod: 2, durationMins: 10 },
        ],
        extraClass: [],
      }),
    ).toThrow(BusinessException);
  });
});
