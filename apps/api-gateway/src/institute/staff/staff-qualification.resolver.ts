import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard, InstituteScopeGuard } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import { FileLoaders } from '../../files/file.loaders';
import { FileRefModel } from '../../files/models/file-ref.model';
import type { FileRecord } from '../../files/repositories/types';
import { CreateStaffQualificationInput } from './dto/create-staff-qualification.input';
import { UpdateStaffQualificationInput } from './dto/update-staff-qualification.input';
import { StaffQualificationModel } from './models/staff-qualification.model';
import { StaffQualificationService } from './staff-qualification.service';

/**
 * GraphQL resolver exposing structured staff qualifications. All operations
 * are institute-scoped (tenant isolation via `withTenant`) and gated by CASL
 * abilities on the `Staff` subject — the same subject that governs the
 * parent profile (no dedicated CASL subject for qualifications).
 */
@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
@Resolver(() => StaffQualificationModel)
export class StaffQualificationResolver {
  constructor(
    private readonly service: StaffQualificationService,
    private readonly loaders: FileLoaders,
  ) {}

  @ResolveField(() => FileRefModel, {
    nullable: true,
    description: 'Scan of the certificate. For an image, ask for `url(variant: MD)` to preview.',
  })
  certificate(@Parent() qualification: StaffQualificationModel): Promise<FileRecord | null> {
    return qualification.certificateFileId
      ? this.loaders.readyById.load(qualification.certificateFileId)
      : Promise.resolve(null);
  }

  @Query(() => [StaffQualificationModel], {
    description: 'List qualifications for a given staff profile',
  })
  @CheckAbility({ action: 'read', subject: 'Staff' })
  async listStaffQualifications(
    @Args('staffProfileId', { type: () => ID }) staffProfileId: string,
  ): Promise<StaffQualificationModel[]> {
    return this.service.listForStaff(staffProfileId);
  }

  @Mutation(() => StaffQualificationModel, {
    description: 'Add a qualification record to a staff profile',
  })
  @CheckAbility({ action: 'update', subject: 'Staff' })
  async createStaffQualification(
    @Args('input') input: CreateStaffQualificationInput,
  ): Promise<StaffQualificationModel> {
    return this.service.create(input);
  }

  @Mutation(() => StaffQualificationModel, {
    description: 'Update an existing staff qualification',
  })
  @CheckAbility({ action: 'update', subject: 'Staff' })
  async updateStaffQualification(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateStaffQualificationInput,
  ): Promise<StaffQualificationModel> {
    return this.service.update(id, input);
  }

  @Mutation(() => Boolean, { description: 'Delete a staff qualification record' })
  @CheckAbility({ action: 'update', subject: 'Staff' })
  async deleteStaffQualification(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    return this.service.delete(id);
  }
}
