import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard, InstituteScopeGuard } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import { AcademicYearService } from './academic-year.service';
import { CreateAcademicYearInput } from './dto/create-academic-year.input';
import { SetRolloverSectionMapInput } from './dto/set-rollover-section-map.input';
import { UpdateAcademicYearInput } from './dto/update-academic-year.input';
import { AcademicYearModel } from './models/academic-year.model';
import { AcademicYearRolloverPreview } from './models/academic-year-rollover-preview.model';
import type { AcademicYearRecord } from './repositories/types';

@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
@Resolver(() => AcademicYearModel)
export class AcademicYearResolver {
  constructor(private readonly academicYearService: AcademicYearService) {}

  @Query(() => [AcademicYearModel])
  @CheckAbility({ action: 'read', subject: 'AcademicYear' })
  async academicYears(): Promise<AcademicYearRecord[]> {
    return this.academicYearService.findAll();
  }

  @Query(() => AcademicYearModel)
  @CheckAbility({ action: 'read', subject: 'AcademicYear' })
  async academicYear(@Args('id', { type: () => ID }) id: string): Promise<AcademicYearRecord> {
    return this.academicYearService.findById(id);
  }

  @Query(() => AcademicYearModel, { nullable: true })
  @CheckAbility({ action: 'read', subject: 'AcademicYear' })
  async activeAcademicYear(): Promise<AcademicYearRecord | null> {
    return this.academicYearService.findActive();
  }

  @Mutation(() => AcademicYearModel)
  @CheckAbility({ action: 'create', subject: 'AcademicYear' })
  async createAcademicYear(
    @Args('input') input: CreateAcademicYearInput,
  ): Promise<AcademicYearRecord> {
    return this.academicYearService.create(input);
  }

  @Mutation(() => AcademicYearModel)
  @CheckAbility({ action: 'update', subject: 'AcademicYear' })
  async updateAcademicYear(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateAcademicYearInput,
  ): Promise<AcademicYearRecord> {
    return this.academicYearService.update(id, input);
  }

  @Query(() => AcademicYearRolloverPreview, {
    description:
      'Counts what activating this year would do to the students of the active year. Writes nothing.',
  })
  @CheckAbility({ action: 'update', subject: 'AcademicYear' })
  async academicYearRolloverPreview(
    @Args('academicYearId', { type: () => ID }) academicYearId: string,
  ): Promise<AcademicYearRolloverPreview> {
    return this.academicYearService.previewRollover(academicYearId);
  }

  @Mutation(() => AcademicYearRolloverPreview, {
    description:
      'Chooses where the rollover sends the students of sections of the active year when this year is activated. Sets the override of each section named in entries and leaves the others; returns the new preview.',
  })
  @CheckAbility({ action: 'update', subject: 'AcademicYear' })
  async setRolloverSectionMap(
    @Args('input') input: SetRolloverSectionMapInput,
  ): Promise<AcademicYearRolloverPreview> {
    return this.academicYearService.setRolloverSectionMap(input.academicYearId, input.entries);
  }

  @Mutation(() => AcademicYearModel)
  @CheckAbility({ action: 'update', subject: 'AcademicYear' })
  async activateAcademicYear(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<AcademicYearRecord> {
    return this.academicYearService.activate(id);
  }

  @Mutation(() => AcademicYearModel)
  @CheckAbility({ action: 'update', subject: 'AcademicYear' })
  async archiveAcademicYear(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<AcademicYearRecord> {
    return this.academicYearService.archive(id);
  }

  @Mutation(() => Boolean)
  @CheckAbility({ action: 'delete', subject: 'AcademicYear' })
  async deleteAcademicYear(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    return this.academicYearService.delete(id);
  }
}
