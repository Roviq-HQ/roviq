import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard, InstituteScopeGuard } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import { CreateTimetableDayOverrideInput } from './dto/timetable.inputs';
import {
  DayScheduleModel,
  DayScheduleSlotModel,
  TimetableDayOverrideModel,
  TimetableGridModel,
} from './models/timetable.model';
import type { TimetableDayOverrideRecord } from './repositories/types';
import {
  type DaySchedule,
  type DayScheduleSlot,
  TimetableViewService,
} from './timetable-view.service';

@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
@Resolver()
export class TimetableViewResolver {
  constructor(private readonly view: TimetableViewService) {}

  @Query(() => TimetableGridModel, {
    nullable: true,
    description:
      'Weekly grid for a section. Defaults to the active timetable covering the section.',
  })
  @CheckAbility('read', 'Timetable')
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
  @CheckAbility('read', 'Timetable')
  staffTimetable(
    @Args('teacherId', { type: () => ID }) teacherId: string,
    @Args('timetableId', { type: () => ID, nullable: true }) timetableId: string | null,
  ): Promise<TimetableGridModel | null> {
    return this.view.staffTimetable(
      teacherId,
      timetableId ?? undefined,
    ) as Promise<TimetableGridModel | null>;
  }

  @Query(() => DayScheduleModel, {
    description:
      'Resolved schedule for a section on a date (master entries with overrides applied).',
  })
  @CheckAbility('read', 'Timetable')
  timetableDaySchedule(
    @Args('date', { type: () => String }) date: string,
    @Args('sectionId', { type: () => ID }) sectionId: string,
  ): Promise<DaySchedule> {
    return this.view.daySchedule(date, sectionId);
  }

  @Query(() => [DayScheduleSlotModel], {
    description: 'Resolved schedule for a teacher on a date.',
  })
  @CheckAbility('read', 'Timetable')
  staffDaySchedule(
    @Args('date', { type: () => String }) date: string,
    @Args('teacherId', { type: () => ID }) teacherId: string,
  ): Promise<DayScheduleSlot[]> {
    return this.view.staffDaySchedule(date, teacherId);
  }

  @Query(() => [TimetableDayOverrideModel])
  @CheckAbility('read', 'Timetable')
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
  @CheckAbility('update', 'Timetable')
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
  @CheckAbility('update', 'Timetable')
  clearTimetableDayOverride(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    return this.view.clearOverride(id);
  }
}
