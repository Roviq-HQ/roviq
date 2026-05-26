import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import {
  DaySession,
  PeriodKind,
  TimetableOverrideType,
  TimetableStatus,
  Weekday,
} from '@roviq/common-types';
import type { I18nContent } from '@roviq/database';
import { DateTimeScalar, I18nTextScalar } from '@roviq/nestjs-graphql';

registerEnumType(TimetableStatus, {
  name: 'TimetableStatus',
  description: 'Lifecycle of a timetable: DRAFT → ACTIVE → INACTIVE/ARCHIVED. One ACTIVE per year.',
});
registerEnumType(Weekday, {
  name: 'Weekday',
  description: 'Day of the week a period runs (Sunday supported via workingDays).',
});
registerEnumType(PeriodKind, {
  name: 'PeriodKind',
  description:
    'Period type: PERIOD (teaching, assignable), BREAK (lunch/recess), EXTRA (zero/evening).',
});
registerEnumType(DaySession, {
  name: 'DaySession',
  description: 'Where the period sits in the day: MORNING (extra), MAIN, or EVENING (extra).',
});
registerEnumType(TimetableOverrideType, {
  name: 'TimetableOverrideType',
  description:
    'Per-date deviation: SUBSTITUTION, CANCELLATION, ROOM_CHANGE, SUBJECT_CHANGE, EXTRA.',
});

@ObjectType({
  description: 'A weekly schedule template for a set of sections within an academic year.',
})
export class TimetableModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  academicYearId!: string;

  @Field(() => I18nTextScalar, {
    description: 'Localised timetable name, e.g. { en: "Summer 2026" }.',
  })
  name!: I18nContent;

  @Field(() => String, { nullable: true })
  description!: string | null;

  @Field(() => TimetableStatus)
  status!: TimetableStatus;

  @Field(() => String, { description: 'First date the timetable is in effect (YYYY-MM-DD).' })
  effectiveFrom!: string;

  @Field(() => String, { description: 'Last date the timetable is in effect (YYYY-MM-DD).' })
  effectiveTo!: string;

  @Field(() => [Weekday], { description: 'Days the timetable runs (subset of Mon–Sun).' })
  workingDays!: Weekday[];

  @Field(() => String, { description: 'Start time of the first regular period (HH:mm:ss).' })
  dayStartTime!: string;

  @Field(() => Int, { description: 'Default minutes per regular period.' })
  defaultPeriodDurationMins!: number;

  @Field(() => DateTimeScalar)
  createdAt!: Date;

  @Field(() => DateTimeScalar)
  updatedAt!: Date;
}

@ObjectType({ description: 'One row in the timetable time grid (period, break, or extra).' })
export class TimetablePeriodModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  timetableId!: string;

  @Field(() => PeriodKind)
  kind!: PeriodKind;

  @Field(() => String, {
    description: 'Display label: "1","2",…, the break name, or "Morning Extra 1".',
  })
  label!: string;

  @Field(() => Int, { description: 'Ordering within the day (lower = earlier).' })
  sequence!: number;

  @Field(() => String, { description: 'Period start (HH:mm:ss).' })
  startTime!: string;

  @Field(() => String, { description: 'Period end (HH:mm:ss).' })
  endTime!: string;

  @Field(() => DaySession)
  session!: DaySession;

  @Field(() => DateTimeScalar)
  createdAt!: Date;

  @Field(() => DateTimeScalar)
  updatedAt!: Date;
}

@ObjectType({ description: 'A class section covered by a timetable.' })
export class TimetableSectionModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  timetableId!: string;

  @Field(() => ID)
  sectionId!: string;

  @Field(() => DateTimeScalar)
  createdAt!: Date;

  @Field(() => DateTimeScalar)
  updatedAt!: Date;
}

@ObjectType({
  description: 'One assignment cell: a subject/teacher/room for a section, period, weekday, split.',
})
export class TimetableEntryModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  timetableId!: string;

  @Field(() => ID)
  periodId!: string;

  @Field(() => ID)
  sectionId!: string;

  @Field(() => Weekday)
  dayOfWeek!: Weekday;

  @Field(() => Int, { description: 'Parallel-group index (0 = whole class / first group).' })
  splitIndex!: number;

  @Field(() => String, { nullable: true, description: 'Class-split group label, e.g. "Group A".' })
  splitLabel!: string | null;

  @Field(() => ID, { nullable: true })
  subjectId!: string | null;

  @Field(() => ID, { nullable: true, description: 'Membership id of the assigned teacher.' })
  teacherId!: string | null;

  @Field(() => String, { nullable: true })
  room!: string | null;

  @Field(() => String, { nullable: true })
  notes!: string | null;

  @Field(() => DateTimeScalar)
  createdAt!: Date;

  @Field(() => DateTimeScalar)
  updatedAt!: Date;
}

@ObjectType({ description: 'A per-date deviation from the master timetable.' })
export class TimetableDayOverrideModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  timetableId!: string;

  @Field(() => String, { description: 'The date this override applies to (YYYY-MM-DD).' })
  date!: string;

  @Field(() => ID)
  sectionId!: string;

  @Field(() => ID)
  periodId!: string;

  @Field(() => Int)
  splitIndex!: number;

  @Field(() => TimetableOverrideType)
  overrideType!: TimetableOverrideType;

  @Field(() => ID, { nullable: true })
  subjectId!: string | null;

  @Field(() => ID, { nullable: true })
  teacherId!: string | null;

  @Field(() => String, { nullable: true })
  room!: string | null;

  @Field(() => ID, {
    nullable: true,
    description: 'Subject originally scheduled (snapshot for audit).',
  })
  originalSubjectId!: string | null;

  @Field(() => ID, {
    nullable: true,
    description: 'Teacher originally scheduled (snapshot for audit).',
  })
  originalTeacherId!: string | null;

  @Field(() => String, { nullable: true })
  reason!: string | null;

  @Field(() => DateTimeScalar)
  createdAt!: Date;

  @Field(() => DateTimeScalar)
  updatedAt!: Date;
}

@ObjectType({
  description: 'A weekly grid (section or staff view): the period rows, working days, and cells.',
})
export class TimetableGridModel {
  @Field(() => ID)
  timetableId!: string;

  @Field(() => [TimetablePeriodModel])
  periods!: TimetablePeriodModel[];

  @Field(() => [Weekday])
  workingDays!: Weekday[];

  @Field(() => [TimetableEntryModel])
  entries!: TimetableEntryModel[];
}

@ObjectType({
  description: 'One resolved cell for a specific date (master entry with overrides applied).',
})
export class DayScheduleSlotModel {
  @Field(() => ID)
  periodId!: string;

  @Field(() => String)
  label!: string;

  @Field(() => PeriodKind)
  kind!: PeriodKind;

  @Field(() => String)
  startTime!: string;

  @Field(() => String)
  endTime!: string;

  @Field(() => Int)
  splitIndex!: number;

  @Field(() => String, { nullable: true })
  splitLabel!: string | null;

  @Field(() => ID)
  sectionId!: string;

  @Field(() => ID, { nullable: true })
  subjectId!: string | null;

  @Field(() => ID, { nullable: true })
  teacherId!: string | null;

  @Field(() => String, { nullable: true })
  room!: string | null;

  @Field(() => Boolean, { description: 'True when a day override changed this cell.' })
  isOverride!: boolean;

  @Field(() => TimetableOverrideType, { nullable: true })
  overrideType!: TimetableOverrideType | null;
}

@ObjectType({ description: 'The resolved schedule for one section on one date.' })
export class DayScheduleModel {
  @Field(() => String)
  date!: string;

  @Field(() => Weekday)
  dayOfWeek!: Weekday;

  @Field(() => ID)
  sectionId!: string;

  @Field(() => ID, { nullable: true })
  timetableId!: string | null;

  @Field(() => [DayScheduleSlotModel])
  slots!: DayScheduleSlotModel[];
}

@ObjectType({ description: 'Counts of timetables by status for the dashboard.' })
export class TimetableStatisticsModel {
  @Field(() => Int)
  total!: number;

  @Field(() => Int)
  draft!: number;

  @Field(() => Int)
  active!: number;

  @Field(() => Int)
  inactive!: number;

  @Field(() => Int)
  archived!: number;
}

@ObjectType({ description: 'A page of timetables.' })
export class PaginatedTimetablesModel {
  @Field(() => [TimetableModel])
  docs!: TimetableModel[];

  @Field(() => Int)
  total!: number;

  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  perPage!: number;

  @Field(() => Int)
  totalPages!: number;
}
