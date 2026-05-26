import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard, InstituteScopeGuard } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import { TimetableStatus } from '@roviq/common-types';
import {
  AddTimetablePeriodInput,
  AssignTimetableEntryInput,
  ClearTimetableEntryInput,
  CreateTimetableInput,
  UpdateTimetableInput,
  UpdateTimetablePeriodInput,
} from './dto/timetable.inputs';
import {
  PaginatedTimetablesModel,
  TimetableEntryModel,
  TimetableModel,
  TimetablePeriodModel,
  TimetableSectionModel,
  TimetableStatisticsModel,
} from './models/timetable.model';
import type {
  TimetableEntryRecord,
  TimetablePeriodRecord,
  TimetableRecord,
  TimetableSectionRecord,
} from './repositories/types';
import { TimetableService } from './timetable.service';
import { TimetableScheduleService } from './timetable-schedule.service';

@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
@Resolver(() => TimetableModel)
export class TimetableResolver {
  constructor(
    private readonly service: TimetableService,
    private readonly schedule: TimetableScheduleService,
  ) {}

  @Query(() => PaginatedTimetablesModel)
  @CheckAbility('read', 'Timetable')
  timetables(
    @Args('academicYearId', { type: () => ID }) academicYearId: string,
    @Args('status', { type: () => TimetableStatus, nullable: true }) status: TimetableStatus | null,
    @Args('sectionId', { type: () => ID, nullable: true }) sectionId: string | null,
    @Args('search', { type: () => String, nullable: true }) search: string | null,
    @Args('page', { type: () => Int, nullable: true, defaultValue: 1 }) page: number,
    @Args('perPage', { type: () => Int, nullable: true, defaultValue: 20 }) perPage: number,
  ): Promise<PaginatedTimetablesModel> {
    return this.service.list({
      academicYearId,
      status: status ?? undefined,
      sectionId: sectionId ?? undefined,
      search: search ?? undefined,
      page,
      perPage,
    }) as Promise<PaginatedTimetablesModel>;
  }

  @Query(() => TimetableModel)
  @CheckAbility('read', 'Timetable')
  timetable(@Args('id', { type: () => ID }) id: string): Promise<TimetableRecord> {
    return this.service.findById(id);
  }

  @Query(() => TimetableStatisticsModel)
  @CheckAbility('read', 'Timetable')
  timetableStatistics(
    @Args('academicYearId', { type: () => ID, nullable: true }) academicYearId: string | null,
  ) {
    return this.service.statistics(academicYearId ?? undefined);
  }

  @ResolveField(() => [TimetablePeriodModel])
  periods(@Parent() timetable: TimetableModel): Promise<TimetablePeriodRecord[]> {
    return this.service.getPeriods(timetable.id);
  }

  @ResolveField(() => [TimetableSectionModel])
  sections(@Parent() timetable: TimetableModel): Promise<TimetableSectionRecord[]> {
    return this.service.getSections(timetable.id);
  }

  @Mutation(() => TimetableModel)
  @CheckAbility('create', 'Timetable')
  createTimetable(@Args('input') input: CreateTimetableInput): Promise<TimetableRecord> {
    return this.service.create({
      academicYearId: input.academicYearId,
      name: input.name,
      description: input.description ?? null,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      workingDays: input.workingDays,
      dayStartTime: input.dayStartTime,
      defaultPeriodDurationMins: input.defaultPeriodDurationMins,
      periodsCount: input.periodsCount,
      sectionIds: input.sectionIds,
      lunch: input.lunch.map((l) => ({
        name: l.name,
        afterPeriod: l.afterPeriod,
        durationMins: l.durationMins,
      })),
      extraClass: input.extraClass.map((e) => ({
        session: e.session,
        startTime: e.startTime,
        durationMins: e.durationMins,
        count: e.count,
      })),
    });
  }

  @Mutation(() => TimetableModel)
  @CheckAbility('update', 'Timetable')
  updateTimetable(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateTimetableInput,
  ): Promise<TimetableRecord> {
    return this.service.update(id, input);
  }

  @Mutation(() => TimetableModel, { description: 'Publish a timetable (DRAFT/INACTIVE → ACTIVE).' })
  @CheckAbility('update', 'Timetable')
  activateTimetable(@Args('id', { type: () => ID }) id: string): Promise<TimetableRecord> {
    return this.service.activate(id);
  }

  @Mutation(() => TimetableModel, {
    description: 'Retire the active timetable (ACTIVE → INACTIVE).',
  })
  @CheckAbility('update', 'Timetable')
  deactivateTimetable(@Args('id', { type: () => ID }) id: string): Promise<TimetableRecord> {
    return this.service.deactivate(id);
  }

  @Mutation(() => TimetableModel, { description: 'Permanently retire a timetable (→ ARCHIVED).' })
  @CheckAbility('update', 'Timetable')
  archiveTimetable(@Args('id', { type: () => ID }) id: string): Promise<TimetableRecord> {
    return this.service.archive(id);
  }

  @Mutation(() => Int, { description: 'Soft-delete timetables. Returns the count removed.' })
  @CheckAbility('delete', 'Timetable')
  deleteTimetable(@Args('ids', { type: () => [ID] }) ids: string[]): Promise<number> {
    return this.service.delete(ids);
  }

  @Mutation(() => Int, {
    description: 'Restore soft-deleted timetables. Returns the count restored.',
  })
  @CheckAbility('delete', 'Timetable')
  restoreTimetable(@Args('ids', { type: () => [ID] }) ids: string[]): Promise<number> {
    return this.service.restore(ids);
  }

  @Mutation(() => TimetableSectionModel)
  @CheckAbility('update', 'Timetable')
  addTimetableSection(
    @Args('timetableId', { type: () => ID }) timetableId: string,
    @Args('sectionId', { type: () => ID }) sectionId: string,
  ): Promise<TimetableSectionRecord> {
    return this.service.addSection(timetableId, sectionId);
  }

  @Mutation(() => Boolean)
  @CheckAbility('update', 'Timetable')
  removeTimetableSection(
    @Args('timetableId', { type: () => ID }) timetableId: string,
    @Args('sectionId', { type: () => ID }) sectionId: string,
  ): Promise<boolean> {
    return this.service.removeSection(timetableId, sectionId);
  }

  @Mutation(() => TimetablePeriodModel)
  @CheckAbility('update', 'Timetable')
  addTimetablePeriod(
    @Args('input') input: AddTimetablePeriodInput,
  ): Promise<TimetablePeriodRecord> {
    return this.service.addPeriod({
      timetableId: input.timetableId,
      kind: input.kind,
      label: input.label,
      startTime: input.startTime,
      durationMins: input.durationMins,
      session: input.session,
    });
  }

  @Mutation(() => TimetablePeriodModel)
  @CheckAbility('update', 'Timetable')
  updateTimetablePeriod(
    @Args('timetableId', { type: () => ID }) timetableId: string,
    @Args('periodId', { type: () => ID }) periodId: string,
    @Args('input') input: UpdateTimetablePeriodInput,
  ): Promise<TimetablePeriodRecord> {
    return this.service.updatePeriod(timetableId, periodId, input);
  }

  @Mutation(() => Boolean)
  @CheckAbility('update', 'Timetable')
  removeTimetablePeriod(
    @Args('timetableId', { type: () => ID }) timetableId: string,
    @Args('periodId', { type: () => ID }) periodId: string,
  ): Promise<boolean> {
    return this.service.removePeriod(timetableId, periodId);
  }

  @Mutation(() => [TimetableEntryModel], {
    description:
      'Assign subject/teacher/room to a cell for one or more weekdays (supports class-split).',
  })
  @CheckAbility('update', 'Timetable')
  assignTimetableEntry(
    @Args('input') input: AssignTimetableEntryInput,
  ): Promise<TimetableEntryRecord[]> {
    return this.schedule.assignEntry({
      timetableId: input.timetableId,
      sectionId: input.sectionId,
      periodId: input.periodId,
      days: input.days,
      splits: input.splits.map((s) => ({
        splitIndex: s.splitIndex,
        splitLabel: s.splitLabel ?? null,
        subjectId: s.subjectId ?? null,
        teacherId: s.teacherId ?? null,
        room: s.room ?? null,
      })),
    });
  }

  @Mutation(() => Boolean)
  @CheckAbility('update', 'Timetable')
  clearTimetableEntry(@Args('input') input: ClearTimetableEntryInput): Promise<boolean> {
    return this.schedule.clearEntry({
      timetableId: input.timetableId,
      sectionId: input.sectionId,
      periodId: input.periodId,
      dayOfWeek: input.dayOfWeek,
      splitIndex: input.splitIndex ?? 0,
    });
  }
}
