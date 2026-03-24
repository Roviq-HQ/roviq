import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { PlatformScope } from '@roviq/auth-backend';
import { AbilityGuard, CheckAbility } from '@roviq/casl';
import { CreateInstituteGroupInput } from '../../institute-group/dto/create-institute-group.input';
import { InstituteGroupFilterInput } from '../../institute-group/dto/institute-group-filter.input';
import { UpdateInstituteGroupInput } from '../../institute-group/dto/update-institute-group.input';
import { InstituteGroupService } from '../../institute-group/institute-group.service';
import { InstituteGroupModel } from '../../institute-group/models/institute-group.model';
import { InstituteGroupConnection } from '../../institute-group/models/institute-group-connection.model';

@PlatformScope()
@UseGuards(AbilityGuard)
@Resolver(() => InstituteGroupModel)
export class AdminInstituteGroupResolver {
  constructor(private readonly groupService: InstituteGroupService) {}

  @Query(() => InstituteGroupConnection)
  @CheckAbility('read', 'InstituteGroup')
  async adminListInstituteGroups(
    @Args('filter', { nullable: true }) filter?: InstituteGroupFilterInput,
  ) {
    return this.groupService.searchWithInstituteCounts(filter ?? {});
  }

  @Mutation(() => InstituteGroupModel)
  @CheckAbility('create', 'InstituteGroup')
  async adminCreateInstituteGroup(@Args('input') input: CreateInstituteGroupInput) {
    return this.groupService.create(input);
  }

  @Mutation(() => InstituteGroupModel)
  @CheckAbility('update', 'InstituteGroup')
  async adminUpdateInstituteGroup(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateInstituteGroupInput,
  ) {
    return this.groupService.update(id, input);
  }

  @Mutation(() => Boolean)
  @CheckAbility('delete', 'InstituteGroup')
  async adminDeleteInstituteGroup(@Args('id', { type: () => ID }) id: string) {
    return this.groupService.delete(id);
  }
}
