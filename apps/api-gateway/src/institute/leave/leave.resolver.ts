import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard, InstituteScopeGuard } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility, CurrentAbility } from '@roviq/casl';
import { type AppAbility, LeaveStatus, LeaveType } from '@roviq/common-types';
import { FileRefModel } from '../../files/models/file-ref.model';
import type { FileRecord } from '../../files/repositories/types';
import { CreateLeaveInput } from './dto/create-leave.input';
import { UpdateLeaveInput } from './dto/update-leave.input';
import { LeaveService } from './leave.service';
import { LeaveModel } from './models/leave.model';
import type { LeaveRecord } from './repositories/types';

@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
@Resolver(() => LeaveModel)
export class LeaveResolver {
  constructor(private readonly service: LeaveService) {}

  @ResolveField(() => [FileRefModel])
  files(
    @Parent() leave: LeaveRecord,
    @CurrentAbility() ability: AppAbility | undefined,
  ): FileRecord[] {
    return this.service.filesVisibleTo(ability, leave);
  }

  @Query(() => [LeaveModel], {
    description:
      'List leave applications, ordered by `startDate` DESC (most recent first — leave UIs are decision-driven, not calendar-driven). Optional filters narrow by user, status, type, and overlapping date range.',
  })
  @CheckAbility({ action: 'read', subject: 'Leave' })
  async leaves(
    @Args('userId', { type: () => ID, nullable: true }) userId: string | null,
    @Args('status', { type: () => LeaveStatus, nullable: true }) status: LeaveStatus | null,
    @Args('type', { type: () => LeaveType, nullable: true }) type: LeaveType | null,
    @Args('startDate', { type: () => String, nullable: true }) startDate: string | null,
    @Args('endDate', { type: () => String, nullable: true }) endDate: string | null,
  ): Promise<LeaveRecord[]> {
    return this.service.list({
      userId: userId ?? undefined,
      status: status ?? undefined,
      type: type ?? undefined,
      startDate: startDate ?? undefined,
      endDate: endDate ?? undefined,
    });
  }

  @Query(() => LeaveModel)
  @CheckAbility({ action: 'read', subject: 'Leave' })
  async leave(@Args('id', { type: () => ID }) id: string): Promise<LeaveRecord> {
    return this.service.findById(id);
  }

  @Mutation(() => LeaveModel, { description: 'Submit a new leave application (PENDING).' })
  @CheckAbility({ action: 'create', subject: 'Leave' })
  async applyLeave(@Args('input') input: CreateLeaveInput): Promise<LeaveRecord> {
    return this.service.apply(input);
  }

  @Mutation(() => LeaveModel, { description: 'Edit a PENDING leave before it is decided.' })
  @CheckAbility({ action: 'update', subject: 'Leave' })
  async updateLeave(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateLeaveInput,
  ): Promise<LeaveRecord> {
    return this.service.update(id, input);
  }

  @Mutation(() => LeaveModel, { description: 'Approve a PENDING leave.' })
  @CheckAbility({ action: 'update', subject: 'Leave' })
  async approveLeave(
    @Args('id', { type: () => ID }) id: string,
    @Args('approverMembershipId', { type: () => ID }) approverMembershipId: string,
  ): Promise<LeaveRecord> {
    return this.service.approve(id, approverMembershipId);
  }

  @Mutation(() => LeaveModel, { description: 'Reject a PENDING leave.' })
  @CheckAbility({ action: 'update', subject: 'Leave' })
  async rejectLeave(
    @Args('id', { type: () => ID }) id: string,
    @Args('approverMembershipId', { type: () => ID }) approverMembershipId: string,
  ): Promise<LeaveRecord> {
    return this.service.reject(id, approverMembershipId);
  }

  @Mutation(() => LeaveModel, { description: 'Cancel an own / pending leave.' })
  @CheckAbility({ action: 'update', subject: 'Leave' })
  async cancelLeave(
    @Args('id', { type: () => ID }) id: string,
    @Args('cancellerMembershipId', { type: () => ID }) cancellerMembershipId: string,
  ): Promise<LeaveRecord> {
    return this.service.cancel(id, cancellerMembershipId);
  }

  @Mutation(() => Boolean, {
    description:
      'Soft-delete a leave application. Returns true on success. Mirrors `deleteHoliday`.',
  })
  @CheckAbility({ action: 'delete', subject: 'Leave' })
  async deleteLeave(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    return this.service.delete(id);
  }
}
