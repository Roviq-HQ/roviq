// libs/database/src/seed/demo/timetable.ts
//
// An ACTIVE weekly timetable for Institute 1's first section: a 6-period day
// with a lunch break, and Mon–Fri entries assigning subjects + the demo
// teacher to each period. Idempotent (fixed ids + onConflict).
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  SYSTEM_USER_ID,
  standardSubjects,
  subjects,
  timetableEntries,
  timetablePeriods,
  timetableSections,
  timetables,
} from '../..';
import type { DrizzleDB } from '../../providers';
import { SEED_IDS } from '../ids';
import { pickPopulatedSection } from './populated-section';

const BY = { createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID };
const WORKING_DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'] as const;

// 6 teaching periods + a lunch break. Sequence is contiguous across the day.
const PERIODS = [
  {
    id: SEED_IDS.TIMETABLE_PERIOD_1_INST1,
    kind: 'PERIOD',
    label: 'Period 1',
    sequence: 1,
    startTime: '08:00',
    endTime: '08:45',
  },
  {
    id: SEED_IDS.TIMETABLE_PERIOD_2_INST1,
    kind: 'PERIOD',
    label: 'Period 2',
    sequence: 2,
    startTime: '08:45',
    endTime: '09:30',
  },
  {
    id: SEED_IDS.TIMETABLE_PERIOD_3_INST1,
    kind: 'PERIOD',
    label: 'Period 3',
    sequence: 3,
    startTime: '09:30',
    endTime: '10:15',
  },
  {
    id: SEED_IDS.TIMETABLE_LUNCH_INST1,
    kind: 'BREAK',
    label: 'Lunch',
    sequence: 4,
    startTime: '10:15',
    endTime: '10:45',
  },
  {
    id: SEED_IDS.TIMETABLE_PERIOD_4_INST1,
    kind: 'PERIOD',
    label: 'Period 4',
    sequence: 5,
    startTime: '10:45',
    endTime: '11:30',
  },
  {
    id: SEED_IDS.TIMETABLE_PERIOD_5_INST1,
    kind: 'PERIOD',
    label: 'Period 5',
    sequence: 6,
    startTime: '11:30',
    endTime: '12:15',
  },
  {
    id: SEED_IDS.TIMETABLE_PERIOD_6_INST1,
    kind: 'PERIOD',
    label: 'Period 6',
    sequence: 7,
    startTime: '12:15',
    endTime: '13:00',
  },
] as const;

export async function seedTimetable(tx: DrizzleDB, inst1Id: string): Promise<void> {
  const exists = await tx.execute(
    sql.raw(`SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='timetables' LIMIT 1`),
  );
  if ((exists as { rows: unknown[] }).rows.length === 0) return;

  // Same populated section the examination seeder targets, for a coherent demo.
  const section = await pickPopulatedSection(tx, inst1Id);
  if (!section) return;

  const teacherId = SEED_IDS.MEMBERSHIP_TEACHER_INST1;

  // Subjects taught in the standard — rotated across the teaching periods.
  const subjectRows = await tx
    .select({ id: subjects.id })
    .from(standardSubjects)
    .innerJoin(subjects, eq(subjects.id, standardSubjects.subjectId))
    .where(
      and(
        eq(standardSubjects.tenantId, inst1Id),
        eq(standardSubjects.standardId, section.standardId),
        isNull(subjects.deletedAt),
      ),
    )
    .orderBy(asc(subjects.id))
    .limit(6);
  if (subjectRows.length === 0) return;

  // Active-per-year is a partial unique index. On a dev DB this is the only
  // timetable so it claims ACTIVE; on a test DB where other timetables are
  // already ACTIVE, fall back to DRAFT so the FK chain below never breaks.
  const [mine] = await tx
    .select({ id: timetables.id })
    .from(timetables)
    .where(eq(timetables.id, SEED_IDS.TIMETABLE_INST1))
    .limit(1);
  if (!mine) {
    const [activeExists] = await tx
      .select({ id: timetables.id })
      .from(timetables)
      .where(
        and(
          eq(timetables.tenantId, inst1Id),
          eq(timetables.academicYearId, section.academicYearId),
          eq(timetables.status, 'ACTIVE'),
          isNull(timetables.deletedAt),
        ),
      )
      .limit(1);
    await tx
      .insert(timetables)
      .values({
        id: SEED_IDS.TIMETABLE_INST1,
        tenantId: inst1Id,
        academicYearId: section.academicYearId,
        name: { en: 'Weekly Timetable 2026–27', hi: 'साप्ताहिक समय-सारिणी 2026–27' },
        description: 'Standard 6-period weekday timetable.',
        status: activeExists ? 'DRAFT' : 'ACTIVE',
        effectiveFrom: '2026-04-01',
        effectiveTo: '2027-03-31',
        workingDays: [...WORKING_DAYS],
        dayStartTime: '08:00',
        defaultPeriodDurationMins: 45,
        ...BY,
      })
      .onConflictDoNothing();
  }

  await tx
    .insert(timetableSections)
    .values({
      tenantId: inst1Id,
      timetableId: SEED_IDS.TIMETABLE_INST1,
      sectionId: section.id,
      ...BY,
    })
    .onConflictDoNothing();

  await tx
    .insert(timetablePeriods)
    .values(
      PERIODS.map((p) => ({
        id: p.id,
        tenantId: inst1Id,
        timetableId: SEED_IDS.TIMETABLE_INST1,
        kind: p.kind,
        label: p.label,
        sequence: p.sequence,
        startTime: p.startTime,
        endTime: p.endTime,
        session: 'MAIN' as const,
        ...BY,
      })),
    )
    .onConflictDoNothing();

  // One entry per (teaching period × working day); rotate subjects so the grid
  // reads naturally. Same teacher throughout (single demo teacher) — no clash
  // since each cell is a distinct (period, day).
  const teachingPeriods = PERIODS.filter((p) => p.kind === 'PERIOD');
  const entries = WORKING_DAYS.flatMap((day, dayIdx) =>
    teachingPeriods.map((period, periodIdx) => ({
      tenantId: inst1Id,
      timetableId: SEED_IDS.TIMETABLE_INST1,
      periodId: period.id,
      sectionId: section.id,
      dayOfWeek: day,
      splitIndex: 0,
      splitLabel: null,
      subjectId: subjectRows[(dayIdx + periodIdx) % subjectRows.length].id,
      teacherId,
      room: `Room ${101 + periodIdx}`,
      notes: null,
      ...BY,
    })),
  );
  await tx.insert(timetableEntries).values(entries).onConflictDoNothing();
}
