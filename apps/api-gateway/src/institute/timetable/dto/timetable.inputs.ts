import { Field, ID, InputType, Int } from '@nestjs/graphql';
import {
  DAY_SESSION_VALUES,
  type DaySession,
  PERIOD_KIND_VALUES,
  type PeriodKind,
  TIMETABLE_OVERRIDE_TYPE_VALUES,
  type TimetableOverrideType,
  WEEKDAY_VALUES,
  type Weekday,
} from '@roviq/common-types';
import { I18nTextScalar } from '@roviq/nestjs-graphql';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

const TIME_REGEX = /^\d{2}:\d{2}(:\d{2})?$/;

@InputType({ description: 'A lunch/recess break inserted after a given regular period.' })
export class LunchSlotInput {
  @IsString()
  @IsNotEmpty()
  @Field(() => String, { description: 'Break display name, e.g. "Lunch".' })
  name!: string;

  @IsInt()
  @Min(1)
  @Field(() => Int, { description: 'Insert the break after this 1-based regular period.' })
  afterPeriod!: number;

  @IsInt()
  @Min(1)
  @Field(() => Int, { description: 'Break duration in minutes.' })
  durationMins!: number;
}

@InputType({ description: 'A block of morning (prepended) or evening (appended) extra periods.' })
export class ExtraClassSlotInput {
  @IsIn(['MORNING', 'EVENING'])
  @Field(() => String, { description: 'MORNING (prepended) or EVENING (appended).' })
  session!: 'MORNING' | 'EVENING';

  @Matches(TIME_REGEX, { message: 'startTime must be HH:mm or HH:mm:ss' })
  @Field(() => String, { description: 'When this block of extra periods starts (HH:mm).' })
  startTime!: string;

  @IsInt()
  @Min(1)
  @Field(() => Int, { description: 'Minutes per extra period.' })
  durationMins!: number;

  @IsInt()
  @Min(1)
  @Field(() => Int, { description: 'How many extra periods in this block.' })
  count!: number;
}

@InputType({ description: 'Create a timetable and auto-generate its period grid.' })
export class CreateTimetableInput {
  @IsUUID()
  @Field(() => ID)
  academicYearId!: string;

  @IsNotEmpty()
  @Field(() => I18nTextScalar, { description: 'Localised name, e.g. { en: "Summer 2026" }.' })
  name!: Record<string, string>;

  @IsOptional()
  @IsString()
  @Field(() => String, { nullable: true })
  description?: string | null;

  @IsDateString()
  @Field(() => String, { description: 'First date in effect (YYYY-MM-DD).' })
  effectiveFrom!: string;

  @IsDateString()
  @Field(() => String, { description: 'Last date in effect (YYYY-MM-DD).' })
  effectiveTo!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsIn(WEEKDAY_VALUES, { each: true })
  @Field(() => [String], { description: 'Days the timetable runs (subset of Mon–Sun).' })
  workingDays!: Weekday[];

  @Matches(TIME_REGEX, { message: 'dayStartTime must be HH:mm or HH:mm:ss' })
  @Field(() => String, { description: 'Start time of the first regular period (HH:mm).' })
  dayStartTime!: string;

  @IsInt()
  @Min(1)
  @Field(() => Int, { description: 'Default minutes per regular period.' })
  defaultPeriodDurationMins!: number;

  @IsInt()
  @Min(1)
  @Field(() => Int, { description: 'How many regular periods per day.' })
  periodsCount!: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('all', { each: true })
  @Field(() => [ID], { description: 'Sections this timetable covers.' })
  sectionIds!: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LunchSlotInput)
  @Field(() => [LunchSlotInput], { description: 'Lunch/recess breaks (can be empty).' })
  lunch!: LunchSlotInput[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExtraClassSlotInput)
  @Field(() => [ExtraClassSlotInput], {
    description: 'Morning/evening extra periods (can be empty).',
  })
  extraClass!: ExtraClassSlotInput[];
}

@InputType({ description: "Update a timetable's metadata (not its grid or assignments)." })
export class UpdateTimetableInput {
  @IsOptional()
  @IsNotEmpty()
  @Field(() => I18nTextScalar, { nullable: true })
  name?: Record<string, string>;

  @IsOptional()
  @IsString()
  @Field(() => String, { nullable: true })
  description?: string | null;

  @IsOptional()
  @IsDateString()
  @Field(() => String, { nullable: true, description: 'First date in effect (YYYY-MM-DD).' })
  effectiveFrom?: string;

  @IsOptional()
  @IsDateString()
  @Field(() => String, { nullable: true, description: 'Last date in effect (YYYY-MM-DD).' })
  effectiveTo?: string;

  @IsOptional()
  @IsArray()
  @IsIn(WEEKDAY_VALUES, { each: true })
  @Field(() => [String], { nullable: true })
  workingDays?: Weekday[];
}

@InputType({ description: 'Append a period, break, or extra slot to a timetable.' })
export class AddTimetablePeriodInput {
  @IsUUID()
  @Field(() => ID)
  timetableId!: string;

  @IsIn(PERIOD_KIND_VALUES)
  @Field(() => String, { description: 'PERIOD, BREAK, or EXTRA.' })
  kind!: PeriodKind;

  @IsOptional()
  @IsString()
  @Field(() => String, {
    nullable: true,
    description: 'Custom label (defaults sensibly per kind).',
  })
  label?: string;

  @IsOptional()
  @Matches(TIME_REGEX, { message: 'startTime must be HH:mm or HH:mm:ss' })
  @Field(() => String, {
    nullable: true,
    description: 'Defaults to the end of the last main period.',
  })
  startTime?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Field(() => Int, { nullable: true, description: 'Defaults to the timetable period duration.' })
  durationMins?: number;

  @IsOptional()
  @IsIn(DAY_SESSION_VALUES)
  @Field(() => String, { nullable: true })
  session?: DaySession;
}

@InputType({ description: "Adjust a period's label or times." })
export class UpdateTimetablePeriodInput {
  @IsOptional()
  @IsString()
  @Field(() => String, { nullable: true })
  label?: string;

  @IsOptional()
  @Matches(TIME_REGEX)
  @Field(() => String, { nullable: true })
  startTime?: string;

  @IsOptional()
  @Matches(TIME_REGEX)
  @Field(() => String, { nullable: true })
  endTime?: string;
}

@InputType({
  description:
    'One parallel group within a cell (class-split). Whole class = single split, index 0.',
})
export class AssignSplitInput {
  @IsInt()
  @Min(0)
  @Field(() => Int)
  splitIndex!: number;

  @IsOptional()
  @IsString()
  @Field(() => String, { nullable: true, description: 'Group label, e.g. "Group A".' })
  splitLabel?: string | null;

  @IsOptional()
  @IsUUID()
  @Field(() => ID, { nullable: true })
  subjectId?: string | null;

  @IsOptional()
  @IsUUID()
  @Field(() => ID, { nullable: true, description: 'Membership id of the teacher.' })
  teacherId?: string | null;

  @IsOptional()
  @IsString()
  @Field(() => String, { nullable: true })
  room?: string | null;
}

@InputType({
  description: 'Assign subject/teacher/room to a period cell for one or more weekdays.',
})
export class AssignTimetableEntryInput {
  @IsUUID()
  @Field(() => ID)
  timetableId!: string;

  @IsUUID()
  @Field(() => ID)
  sectionId!: string;

  @IsUUID()
  @Field(() => ID)
  periodId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsIn(WEEKDAY_VALUES, { each: true })
  @Field(() => [String], { description: 'Weekdays to apply these splits to.' })
  days!: Weekday[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AssignSplitInput)
  @Field(() => [AssignSplitInput], {
    description: 'Parallel groups (one for a whole-class assignment).',
  })
  splits!: AssignSplitInput[];
}

@InputType({ description: 'Clear one assignment cell.' })
export class ClearTimetableEntryInput {
  @IsUUID()
  @Field(() => ID)
  timetableId!: string;

  @IsUUID()
  @Field(() => ID)
  sectionId!: string;

  @IsUUID()
  @Field(() => ID)
  periodId!: string;

  @IsIn(WEEKDAY_VALUES)
  @Field(() => String)
  dayOfWeek!: Weekday;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Field(() => Int, { nullable: true, defaultValue: 0 })
  splitIndex?: number;
}

@InputType({
  description:
    'Create a per-date override (substitution, cancellation, room/subject change, extra).',
})
export class CreateTimetableDayOverrideInput {
  @IsUUID()
  @Field(() => ID)
  timetableId!: string;

  @IsDateString()
  @Field(() => String, { description: 'The date this override applies to (YYYY-MM-DD).' })
  date!: string;

  @IsUUID()
  @Field(() => ID)
  sectionId!: string;

  @IsUUID()
  @Field(() => ID)
  periodId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Field(() => Int, { nullable: true, defaultValue: 0 })
  splitIndex?: number;

  @IsIn(TIMETABLE_OVERRIDE_TYPE_VALUES)
  @Field(() => String, {
    description: 'SUBSTITUTION, CANCELLATION, ROOM_CHANGE, SUBJECT_CHANGE, EXTRA.',
  })
  overrideType!: TimetableOverrideType;

  @IsOptional()
  @IsUUID()
  @Field(() => ID, { nullable: true })
  subjectId?: string | null;

  @IsOptional()
  @IsUUID()
  @Field(() => ID, { nullable: true, description: 'Substitute teacher membership id.' })
  teacherId?: string | null;

  @IsOptional()
  @IsString()
  @Field(() => String, { nullable: true })
  room?: string | null;

  @IsOptional()
  @IsString()
  @Field(() => String, { nullable: true })
  reason?: string | null;
}
