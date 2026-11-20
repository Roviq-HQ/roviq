import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser, GqlAuthGuard, InstituteScopeGuard } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility, CurrentAbility } from '@roviq/casl';
import { type AppAbility, type AuthUser, LeaveStatus, LeaveType } from '@roviq/common-types';
import { CreateLeaveInput } from './dto/create-leave.input';
import { UpdateLeaveInput } from './dto/update-leave.input';
import { LeaveService } from './leave.service';
import { LeaveModel } from './models/leave.model';
import type { LeaveRecord } from './repositories/types';

@UseGuards(GqlAuthGuard, InstituteScopeGuard, AbilityGuard)
@Resolver(() => LeaveModel)
export class LeaveResolver {
  constructor(private readonly service: LeaveService) {}

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
    @CurrentAbility() ability: AppAbility,
  ): Promise<LeaveRecord[]> {
    return this.service.list(
      {
        userId: userId ?? undefined,
        status: status ?? undefined,
        type: type ?? undefined,
        startDate: startDate ?? undefined,
        endDate: endDate ?? undefined,
      },
      ability,
    );
  }

  @Query(() => LeaveModel)
  @CheckAbility({ action: 'read', subject: 'Leave' })
  async leave(
    @Args('id', { type: () => ID }) id: string,
    @CurrentAbility() ability: AppAbility,
  ): Promise<LeaveRecord> {
    return this.service.findById(id, ability);
  }

  @Mutation(() => LeaveModel, { description: 'Submit a new leave application (PENDING).' })
  @CheckAbility({ action: 'create', subject: 'Leave' })
  async applyLeave(
    @Args('input') input: CreateLeaveInput,
    @CurrentAbility() ability: AppAbility,
  ): Promise<LeaveRecord> {
    return this.service.apply(input, ability);
  }

  @Mutation(() => LeaveModel, { description: 'Edit a PENDING leave before it is decided.' })
  @CheckAbility({ action: 'update', subject: 'Leave' })
  async updateLeave(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateLeaveInput,
    @CurrentAbility() ability: AppAbility,
  ): Promise<LeaveRecord> {
    return this.service.update(id, input, ability);
  }

  @Mutation(() => LeaveModel, { description: 'Approve a PENDING leave.' })
  @CheckAbility({ action: 'update', subject: 'Leave' })
  async approveLeave(
    @Args('id', { type: () => ID }) id: string,
    @CurrentAbility() ability: AppAbility,
    @CurrentUser() user: AuthUser,
  ): Promise<LeaveRecord> {
    return this.service.approve(id, ability, user.membershipId);
  }

  @Mutation(() => LeaveModel, { description: 'Reject a PENDING leave.' })
  @CheckAbility({ action: 'update', subject: 'Leave' })
  async rejectLeave(
    @Args('id', { type: () => ID }) id: string,
    @CurrentAbility() ability: AppAbility,
    @CurrentUser() user: AuthUser,
  ): Promise<LeaveRecord> {
    return this.service.reject(id, ability, user.membershipId);
  }

  @Mutation(() => LeaveModel, { description: 'Cancel a leave.' })
  @CheckAbility({ action: 'update', subject: 'Leave' })
  async cancelLeave(
    @Args('id', { type: () => ID }) id: string,
    @CurrentAbility() ability: AppAbility,
    @CurrentUser() user: AuthUser,
  ): Promise<LeaveRecord> {
    return this.service.cancel(id, ability, user.membershipId);
  }

  @Mutation(() => Boolean, {
    description:
      'Soft-delete a leave application. Returns true on success. Mirrors `deleteHoliday`.',
  })
  @CheckAbility({ action: 'delete', subject: 'Leave' })
  async deleteLeave(
    @Args('id', { type: () => ID }) id: string,
    @CurrentAbility() ability: AppAbility,
  ): Promise<boolean> {
    return this.service.delete(id, ability);
  }
}
