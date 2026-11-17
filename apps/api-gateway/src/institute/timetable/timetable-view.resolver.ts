import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard, InstituteScopeGuard } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import { CreateTimetableDayOverrideInput } from './dto/timetable.inputs';
import { TeacherOptionModel } from './models/teacher-option.model';
import {
  DayScheduleModel,
  DayScheduleSlotModel,
  TimetableDayOverrideModel,
  TimetableGridModel,
} from './models/timetable.model';
import type { TimetableDayOverrideRecord } from './repositories/types';
import { TimetablePdfService } from './timetable-pdf.service';
import {
  type DaySchedule,
  type DayScheduleSlot,
  TimetableViewService,
} from './timetable-view.service';

@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
@Resolver()
export class TimetableViewResolver {
  constructor(
    private readonly view: TimetableViewService,
    private readonly pdf: TimetablePdfService,
  ) {}

  @Query(() => TimetableGridModel, {
    nullable: true,
    description:
      'Weekly grid for a section. Defaults to the active timetable covering the section.',
  })
  @CheckAbility({ action: 'read', subject: 'Timetable' })
  sectionTimetable(
    @Args('sectionId', { type: () => ID }) sectionId: string,
    @Args('timetableId', { type: () => ID, nullable: true }) timetableId: string | null,
  ): Promise<TimetableGridModel | null> {
    return this.view.sectionTimetable(
      sectionId,
      timetableId ?? undefined,
    ) as Promise<TimetableGridModel | null>;
  }

  @Query(() => TimetableGridModel, {
    nullable: true,
    description:
      "Weekly grid for a teacher (membership id). Defaults to the institute's active timetable.",
  })
  @CheckAbility({ action: 'read', subject: 'Timetable' })
  staffTimetable(
    @Args('teacherId', { type: () => ID }) teacherId: string,
    @Args('timetableId', { type: () => ID, nullable: true }) timetableId: string | null,
  ): Promise<TimetableGridModel | null> {
    return this.view.staffTimetable(
      teacherId,
      timetableId ?? undefined,
    ) as Promise<TimetableGridModel | null>;
  }

  @Query(() => [TeacherOptionModel], {
    description:
      'Staff id + display name for timetable grids and assignment dropdowns. Readable with Timetable read so teachers can label cells without Staff-directory access.',
  })
  @CheckAbility({ action: 'read', subject: 'Timetable' })
  teacherOptions(): Promise<TeacherOptionModel[]> {
    return this.view.teacherOptions();
  }

  @Query(() => String, {
    name: 'sectionTimetablePdf',
    description: "Base64-encoded PDF of a section's weekly timetable.",
  })
  @CheckAbility({ action: 'read', subject: 'Timetable' })
  async sectionTimetablePdf(
    @Args('sectionId', { type: () => ID }) sectionId: string,
    @Args('timetableId', { type: () => ID, nullable: true }) timetableId: string | null,
  ): Promise<string> {
    const buffer = await this.pdf.sectionTimetablePdf(sectionId, timetableId ?? undefined);
    return buffer.toString('base64');
  }

  @Query(() => String, {
    name: 'staffTimetablePdf',
    description: "Base64-encoded PDF of a teacher's weekly timetable.",
  })
  @CheckAbility({ action: 'read', subject: 'Timetable' })
  async staffTimetablePdf(
    @Args('teacherId', { type: () => ID }) teacherId: string,
    @Args('timetableId', { type: () => ID, nullable: true }) timetableId: string | null,
  ): Promise<string> {
    const buffer = await this.pdf.staffTimetablePdf(teacherId, timetableId ?? undefined);
    return buffer.toString('base64');
  }

  @Query(() => DayScheduleModel, {
    description:
      'Resolved schedule for a section on a date (master entries with overrides applied).',
  })
  @CheckAbility({ action: 'read', subject: 'Timetable' })
  timetableDaySchedule(
    @Args('date', { type: () => String }) date: string,
    @Args('sectionId', { type: () => ID }) sectionId: string,
  ): Promise<DaySchedule> {
    return this.view.daySchedule(date, sectionId);
  }

  @Query(() => [DayScheduleSlotModel], {
    description: 'Resolved schedule for a teacher on a date.',
  })
  @CheckAbility({ action: 'read', subject: 'Timetable' })
  staffDaySchedule(
    @Args('date', { type: () => String }) date: string,
    @Args('teacherId', { type: () => ID }) teacherId: string,
  ): Promise<DayScheduleSlot[]> {
    return this.view.staffDaySchedule(date, teacherId);
  }

  @Query(() => [TimetableDayOverrideModel])
  @CheckAbility({ action: 'read', subject: 'Timetable' })
  timetableDayOverrides(
    @Args('timetableId', { type: () => ID }) timetableId: string,
    @Args('date', { type: () => String }) date: string,
  ): Promise<TimetableDayOverrideRecord[]> {
    return this.view.listOverrides(timetableId, date);
  }

  @Mutation(() => TimetableDayOverrideModel, {
    description:
      'Add a per-date override (substitution, cancellation, room/subject change, extra).',
  })
  @CheckAbility({ action: 'update', subject: 'Timetable' })
  createTimetableDayOverride(
    @Args('input') input: CreateTimetableDayOverrideInput,
  ): Promise<TimetableDayOverrideRecord> {
    return this.view.createOverride({
      timetableId: input.timetableId,
      date: input.date,
      sectionId: input.sectionId,
      periodId: input.periodId,
      splitIndex: input.splitIndex ?? 0,
      overrideType: input.overrideType,
      subjectId: input.subjectId ?? null,
      teacherId: input.teacherId ?? null,
      room: input.room ?? null,
      reason: input.reason ?? null,
    });
  }

  @Mutation(() => Boolean)
  @CheckAbility({ action: 'update', subject: 'Timetable' })
  clearTimetableDayOverride(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    return this.view.clearOverride(id);
  }
}
